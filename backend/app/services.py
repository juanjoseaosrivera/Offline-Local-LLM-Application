import json
import io
import httpx
from typing import AsyncGenerator
from pypdf import PdfReader
from .config import settings

class OllamaService:
    @staticmethod
    async def get_available_models() -> list[str]:
        """Fetches the list of pulled models from Ollama."""
        url = f"{settings.OLLAMA_URL}/api/tags"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(url)
                if response.status_code == 200:
                    data = response.json()
                    return [model["name"] for model in data.get("models", [])]
        except Exception:
            pass
        return [settings.OLLAMA_MODEL]

    @staticmethod
    async def get_embedding(text: str) -> list[float]:
        """Generates a 768-dimension vector embedding for text using nomic-embed-text."""
        url = f"{settings.OLLAMA_URL}/api/embeddings"
        payload = {
            "model": "nomic-embed-text",
            "prompt": text
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(url, json=payload)
                if response.status_code == 200:
                    return response.json().get("embedding", [])
        except Exception as e:
            print(f"Error generating embedding: {e}")
        return []

    @staticmethod
    async def chat_stream(model: str, messages: list[dict], system_prompt: str | None = None) -> AsyncGenerator[str, None]:
        """Sends chat messages to Ollama and streams the response token-by-token."""
        url = f"{settings.OLLAMA_URL}/api/chat"
        formatted_messages = []
        
        if system_prompt:
            formatted_messages.append({"role": "system", "content": system_prompt})
            
        formatted_messages.extend(messages)
        
        payload = {
            "model": model,
            "messages": formatted_messages,
            "stream": True
        }
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                async with client.stream("POST", url, json=payload) as response:
                    if response.status_code != 200:
                        yield f"Error from Ollama: Status code {response.status_code}"
                        return
                    
                    async for line in response.aiter_lines():
                        if line:
                            try:
                                data = json.loads(line)
                                content = data.get("message", {}).get("content", "")
                                if content:
                                    yield content
                            except json.JSONDecodeError:
                                continue
            except Exception as e:
                yield f"Connection Error: {str(e)}"


class DocumentService:
    @staticmethod
    def extract_text_from_file(file_content: bytes, filename: str) -> str:
        """Extracts text content from an uploaded file (supports .pdf, .txt, .md)."""
        if filename.lower().endswith(".pdf"):
            pdf_file = io.BytesIO(file_content)
            reader = PdfReader(pdf_file)
            text = ""
            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
            return text
        else:
            # Assume it's a plain text or markdown file
            return file_content.decode("utf-8", errors="ignore")

    @staticmethod
    def chunk_text(text: str, chunk_size: int = 700, chunk_overlap: int = 100) -> list[str]:
        """Splits text into chunks of character length with a sliding window overlap."""
        if not text or not text.strip():
            return []
        
        chunks = []
        start = 0
        text_len = len(text)
        
        while start < text_len:
            end = start + chunk_size
            chunks.append(text[start:end].strip())
            start += chunk_size - chunk_overlap
            
        return [c for c in chunks if len(c) > 10]  # Filter out empty/tiny noise chunks
