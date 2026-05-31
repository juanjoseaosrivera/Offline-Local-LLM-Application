from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

# Represents a single chat message in the chat history
class Message(BaseModel):
    role: str = Field(..., description="Role of the speaker: 'user', 'assistant', or 'system'")
    content: str = Field(..., description="Text content of the message")

# Represents the request payload from the React frontend for streaming
class ChatRequest(BaseModel):
    session_id: int = Field(..., description="The SQLite database ID of the active chat session")
    content: str = Field(..., description="The new message content from the user")
    model: Optional[str] = Field(None, description="The specific local model to run")
    system_prompt: Optional[str] = Field(None, description="Optional custom system prompt to override default behavior")

# Represents the standard non-streaming response
class ChatResponse(BaseModel):
    model: str
    message: Message
    done: bool

# Represents a chat session (conversation thread)
class SessionBase(BaseModel):
    title: str

class SessionCreate(SessionBase):
    pass

class SessionResponse(SessionBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True
