import sqlite3
from contextlib import contextmanager
from .config import settings

# Extract the database file path from the SQLite URL (sqlite:///./local_llm.db -> ./local_llm.db)
DB_PATH = settings.DATABASE_URL.replace("sqlite:///", "")

def init_db():
    """Initializes the database and creates the required tables if they don't exist."""
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.cursor()
        
        # 1. Create the Chat Sessions table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # 2. Create the Chat Messages table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
            )
        """)
        
        # 3. Create the Document Chunks table (For RAG vector search)
        # We store the embedding array as a JSON-serialized string of floats.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS document_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                filename TEXT NOT NULL,
                content TEXT NOT NULL,
                embedding TEXT NOT NULL, 
                FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
            )
        """)
        conn.commit()


@contextmanager
def get_db():
    """
    Context manager that yields a database connection.
    Automatically closes the connection when the block is exited.
    """
    conn = sqlite3.connect(DB_PATH)
    # This row factory lets us access rows like dictionaries (e.g. row['title'] instead of row[1])
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()
