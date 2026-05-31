import json
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette import EventSourceResponse

from .config import settings
from .database import init_db, get_db
from .schemas import ChatRequest, SessionCreate, SessionResponse, Message
from .services import OllamaService, DocumentService

# Using lifespan to initialize our database tables when the server starts up
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()  # Create tables in SQLite if they don't exist
    yield

app = FastAPI(
    title="Offline Local LLM API Server", 
    version="1.0.0", 
    lifespan=lifespan
)

# Configure Cross-Origin Resource Sharing (CORS) 
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For local offline development, we allow all origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------
# 1. API: MODELS
# -----------------
@app.get("/api/models")
async def get_models():
    """Returns a list of all models downloaded locally in Ollama."""
    models = await OllamaService.get_available_models()
    return {"models": models}

# -----------------
# 2. API: SESSIONS (Chat Threads)
# -----------------
@app.get("/api/sessions", response_model=list[SessionResponse])
def get_sessions():
    """Lists all chat sessions, ordered from newest to oldest."""
    with get_db() as db:
        cursor = db.cursor()
        cursor.execute("SELECT id, title, created_at FROM sessions ORDER BY created_at DESC")
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

@app.post("/api/sessions", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
def create_session(session: SessionCreate):
    """Creates a new chat session thread."""
    with get_db() as db:
        cursor = db.cursor()
        cursor.execute("INSERT INTO sessions (title) VALUES (?)", (session.title,))
        db.commit()
        session_id = cursor.lastrowid
        
        cursor.execute("SELECT id, title, created_at FROM sessions WHERE id = ?", (session_id,))
        row = cursor.fetchone()
        return dict(row)

@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: int):
    """Deletes a chat session and all its associated messages (cascading)."""
    with get_db() as db:
        cursor = db.cursor()
        cursor.execute("SELECT id FROM sessions WHERE id = ?", (session_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Session not found")
        
        cursor.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        db.commit()
        return {"detail": "Session deleted successfully"}

# -----------------
# 3. API: MESSAGES (Chat History)
# -----------------
@app.get("/api/sessions/{session_id}/messages", response_model=list[Message])
def get_session_messages(session_id: int):
    """Retrieves all chat messages for a specific session in chronological order."""
    with get_db() as db:
        cursor = db.cursor()
        # Verify session exists
        cursor.execute("SELECT id FROM sessions WHERE id = ?", (session_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Session not found")
        
        cursor.execute(
            "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC",
            (session_id,)
        )
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

# ----------------------------------
# 4. API: RAG DOCUMENT INGESTION
# ----------------------------------
@app.post("/api/sessions/{session_id}/documents")
async def upload_document(session_id: int, file: UploadFile = File(...)):
    """Uploads a PDF or text file, chunks it, generates embeddings, and saves to SQLite."""
    with get_db() as db:
        cursor = db.cursor()
        cursor.execute("SELECT id FROM sessions WHERE id = ?", (session_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Session not found")

    try:
        content = await file.read()
        # 1. Extract text from the PDF/Text file
        text = DocumentService.extract_text_from_file(content, file.filename)
        # 2. Split text into chunks
        chunks = DocumentService.chunk_text(text)
        
        if not chunks:
            raise HTTPException(status_code=400, detail="No readable text could be extracted from this file.")
        
        saved_count = 0
        for chunk in chunks:
            # 3. Generate embedding vector via Ollama nomic-embed-text
            embedding = await OllamaService.get_embedding(chunk)
            if not embedding:
                continue
            
            # 4. Save to SQLite database
            with get_db() as db:
                cursor = db.cursor()
                cursor.execute(
                    "INSERT INTO document_chunks (session_id, filename, content, embedding) VALUES (?, ?, ?, ?)",
                    (session_id, file.filename, chunk, json.dumps(embedding))
                )
                db.commit()
            saved_count += 1
            
        return {"filename": file.filename, "chunks_saved": saved_count}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process document: {str(e)}")

@app.get("/api/sessions/{session_id}/documents")
def get_session_documents(session_id: int):
    """Lists all distinct document filenames uploaded to this chat session."""
    with get_db() as db:
        cursor = db.cursor()
        cursor.execute(
            "SELECT DISTINCT filename FROM document_chunks WHERE session_id = ?",
            (session_id,)
        )
        rows = cursor.fetchall()
        return {"documents": [row["filename"] for row in rows]}

# -----------------
# 5. API: STREAMING CHAT (with RAG Context Injection)
# -----------------
@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest):
    """
    Accepts a user message, performs RAG similarity search if documents exist,
    saves the prompt to SQLite, and streams the context-injected response.
    """
    # 1. Check for documents/context to inject for RAG
    context = ""
    with get_db() as db:
        cursor = db.cursor()
        cursor.execute(
            "SELECT content, embedding FROM document_chunks WHERE session_id = ?",
            (request.session_id,)
        )
        chunks = cursor.fetchall()
        
    if chunks:
        # Generate vector embedding for the user's latest query
        query_embedding = await OllamaService.get_embedding(request.content)
        if query_embedding:
            ranked_chunks = []
            for chunk in chunks:
                try:
                    chunk_emb = json.loads(chunk["embedding"])
                    # Cosine similarity for normalized vectors is just the dot product!
                    score = sum(q * c for q, c in zip(query_embedding, chunk_emb))
                    ranked_chunks.append((score, chunk["content"]))
                except Exception:
                    continue
            
            # Sort by score descending and take the top 4 most similar chunks
            ranked_chunks.sort(key=lambda x: x[0], reverse=True)
            top_chunks = [c[1] for c in ranked_chunks[:4]]
            
            if top_chunks:
                context = "\n---\n".join(top_chunks)

    # 2. Save user's raw message to the DB (without document context, keeping DB history clean)
    with get_db() as db:
        cursor = db.cursor()
        cursor.execute("SELECT id FROM sessions WHERE id = ?", (request.session_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Session not found")
        
        cursor.execute(
            "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)",
            (request.session_id, "user", request.content)
        )
        db.commit()

        # 3. Retrieve history to send to Ollama (so the model has context)
        cursor.execute(
            "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC",
            (request.session_id,)
        )
        rows = cursor.fetchall()
        conversation_history = [{"role": r["role"], "content": r["content"]} for r in rows]

    # 4. Inject RAG Context into the final user prompt if found
    if context and conversation_history:
        prompt_with_context = (
            "You are a helpful assistant. Use the following context from uploaded documents to answer the user's question. "
            "If the answer cannot be found in the context, use your general knowledge but make it clear that the document did not contain the answer.\n\n"
            f"Document Context:\n{context}\n\n"
            f"User Question: {request.content}"
        )
        # Modify the last message in history before sending to Ollama
        conversation_history[-1]["content"] = prompt_with_context

    # Resolve model
    model = request.model or settings.OLLAMA_MODEL

    # Event generator for Server-Sent Events (SSE)
    async def event_generator():
        accumulated_response = ""
        try:
            # Stream tokens from Ollama service
            async for token in OllamaService.chat_stream(
                model=model,
                messages=conversation_history,
                system_prompt=request.system_prompt
            ):
                accumulated_response += token
                yield {"event": "message", "data": json.dumps({"text": token})}
                
            # 5. Once stream is successfully completed, save assistant's response to SQLite
            if accumulated_response:
                with get_db() as db:
                    cursor = db.cursor()
                    cursor.execute(
                        "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)",
                        (request.session_id, "assistant", accumulated_response)
                    )
                    db.commit()
                    
        except Exception as e:
            yield {"event": "error", "data": json.dumps({"error": str(e)})}

    return EventSourceResponse(event_generator())
