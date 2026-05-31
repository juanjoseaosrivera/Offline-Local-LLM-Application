import os

class Settings:
    OLLAMA_URL: str = os.getenv("OLLAMA_URL", "http://localhost:11434")
    OLLAMA_MODEL: str = os.getenv("OLLAMA_MODEL", "llama3.2")
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./local_llm.db")

settings = Settings()
