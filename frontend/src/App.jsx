import { useState, useEffect, useRef } from 'react';
import { 
  Plus, 
  Trash2, 
  Send, 
  Square, 
  Sparkles, 
  Bot, 
  User, 
  SlidersHorizontal, 
  MessageSquare,
  Volume2,
  Paperclip,
  FileText,
  Loader2
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';

export default function App() {
  // State variables
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful, concise AI coding assistant.');
  const [showSettings, setShowSettings] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [sessionDocuments, setSessionDocuments] = useState([]);
  const [isUploading, setIsUploading] = useState(false);

  // Refs for scrolling and cancelling streams
  const messagesEndRef = useRef(null);
  const abortControllerRef = useRef(null);

  // API Backend Base URL
  const API_BASE = 'http://localhost:8000/api';

  // ------------------------------------
  // 1. Initial Load & Fetching Config
  // ------------------------------------
  useEffect(() => {
    fetchSessions();
    fetchModels();
  }, []);

  // Fetch messages whenever active session changes
  useEffect(() => {
    if (activeSessionId) {
      fetchMessages(activeSessionId);
      fetchSessionDocuments(activeSessionId);
    } else {
      setMessages([]);
      setSessionDocuments([]);
    }
  }, [activeSessionId]);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  // ------------------------------------
  // 2. API Communication Handlers
  // ------------------------------------
  const fetchSessions = async () => {
    try {
      const response = await fetch(`${API_BASE}/sessions`);
      if (response.ok) {
        const data = await response.json();
        setSessions(data);
        // Default to the most recent session if available and none selected
        if (data.length > 0 && !activeSessionId) {
          setActiveSessionId(data[0].id);
        }
      }
    } catch (error) {
      console.error('Error fetching sessions:', error);
    }
  };

  const fetchModels = async () => {
    try {
      const response = await fetch(`${API_BASE}/models`);
      if (response.ok) {
        const data = await response.json();
        setModels(data.models);
        if (data.models.length > 0) {
          setSelectedModel(data.models[0]);
        }
      }
    } catch (error) {
      console.error('Error fetching models:', error);
    }
  };

  const fetchMessages = async (sessionId) => {
    try {
      const response = await fetch(`${API_BASE}/sessions/${sessionId}/messages`);
      if (response.ok) {
        const data = await response.json();
        setMessages(data);
      }
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  const fetchSessionDocuments = async (sessionId) => {
    try {
      const response = await fetch(`${API_BASE}/sessions/${sessionId}/documents`);
      if (response.ok) {
        const data = await response.json();
        setSessionDocuments(data.documents);
      }
    } catch (error) {
      console.error('Error fetching session docs:', error);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !activeSessionId || isUploading) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${API_BASE}/sessions/${activeSessionId}/documents`, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        alert(`Successfully uploaded and embedded ${file.name}!`);
        fetchSessionDocuments(activeSessionId);
      } else {
        const errData = await response.json();
        alert(`Failed to upload: ${errData.detail || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      alert('Error connecting to backend for file upload.');
    } finally {
      setIsUploading(false);
      // Clear file input
      e.target.value = null;
    }
  };

  const handleCreateSession = async () => {
    const title = prompt('Enter chat session title:', 'New Conversation');
    if (!title || !title.trim()) return;

    try {
      const response = await fetch(`${API_BASE}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim() }),
      });
      if (response.ok) {
        const newSession = await response.json();
        setSessions([newSession, ...sessions]);
        setActiveSessionId(newSession.id);
      }
    } catch (error) {
      console.error('Error creating session:', error);
    }
  };

  const handleDeleteSession = async (e, sessionId) => {
    e.stopPropagation(); // Avoid triggering active session selection
    if (!confirm('Are you sure you want to delete this chat thread?')) return;

    try {
      const response = await fetch(`${API_BASE}/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        const updated = sessions.filter(s => s.id !== sessionId);
        setSessions(updated);
        if (activeSessionId === sessionId) {
          setActiveSessionId(updated.length > 0 ? updated[0].id : null);
        }
      }
    } catch (error) {
      console.error('Error deleting session:', error);
    }
  };

  // ------------------------------------
  // 3. Streaming Chat Engine (SSE Fetch)
  // ------------------------------------
  const handleSendMessage = async (textToSend = null) => {
    const text = textToSend || input;
    if (!text.trim() || !activeSessionId || isGenerating) return;

    // Reset input box
    if (!textToSend) setInput('');

    // 1. Temporarily add the User message to the local list (before backend streams)
    const userMsg = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setIsGenerating(true);

    // 2. Prepare AbortController to support stopping the stream
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // 3. Create a temporary placeholder for the streaming Assistant response
    let partialContent = '';
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      const response = await fetch(`${API_BASE}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: activeSessionId,
          content: text,
          model: selectedModel || undefined,
          system_prompt: systemPrompt || undefined
        }),
        signal: controller.signal
      });

      if (!response.ok) throw new Error('API server returned error status');

      // 4. Set up browser reader for Streaming Response body
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Decode binary block to text
        buffer += decoder.decode(value, { stream: true });
        
        // Split lines by double-newline standard of SSE
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep partial line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(trimmed.slice(6));
              if (parsed.text) {
                partialContent += parsed.text;
                // Update the last message (Assistant) in the list
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { role: 'assistant', content: partialContent };
                  return updated;
                });
              }
            } catch (jsonErr) {
              // Ignore partial JSON lines
            }
          }
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('User cancelled stream generation.');
      } else {
        console.error('Error during streaming:', error);
        setMessages(prev => [
          ...prev, 
          { role: 'assistant', content: `⚠️ Connection Error: Failed to retrieve answer from backend.` }
        ]);
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
      // Reload history to ensure SQLite sync values match
      fetchMessages(activeSessionId);
    }
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleQuickPrompt = (promptText) => {
    setInput(promptText);
  };

  // ------------------------------------
  // 4. Render UI
  // ------------------------------------
  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      
      {/* SIDEBAR: Session Thread History */}
      <aside className="w-72 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
        {/* App Logo */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-violet-500 animate-pulse" />
            <span className="font-bold text-lg tracking-wider bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent">
              LocalMind
            </span>
          </div>
          <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">
            M4 GPU
          </span>
        </div>

        {/* New Chat Button */}
        <div className="p-4">
          <button
            onClick={handleCreateSession}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 font-medium text-white transition-all shadow-lg hover:shadow-violet-600/20 active:scale-[0.98]"
          >
            <Plus className="w-5 h-5" />
            New Chat
          </button>
        </div>

        {/* Sessions List */}
        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          {sessions.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">
              No chats yet. Create one!
            </div>
          ) : (
            sessions.map(session => (
              <div
                key={session.id}
                onClick={() => !isGenerating && setActiveSessionId(session.id)}
                className={`group flex items-center justify-between px-3 py-3 rounded-lg cursor-pointer transition-all ${
                  activeSessionId === session.id 
                    ? 'bg-slate-800/80 border-l-4 border-violet-500 text-white font-medium'
                    : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-2.5 overflow-hidden">
                  <MessageSquare className="w-4 h-4 shrink-0 opacity-70" />
                  <span className="truncate text-sm">{session.title}</span>
                </div>
                <button
                  onClick={(e) => handleDeleteSession(e, session.id)}
                  disabled={isGenerating}
                  className="opacity-0 group-hover:opacity-100 hover:text-red-400 p-1 rounded transition-all hover:bg-slate-700 disabled:opacity-30"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Sidebar Footer: Model and Prompts configuration button */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/40">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="w-full flex items-center justify-between text-sm text-slate-400 hover:text-slate-200 p-2 rounded-lg hover:bg-slate-800/50 transition-all"
          >
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4" />
              <span>Prompt & Settings</span>
            </div>
            <span className="text-xs bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
              {showSettings ? 'Hide' : 'Show'}
            </span>
          </button>
        </div>
      </aside>

      {/* MAIN SCREEN AREA */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-950">
        
        {/* TOP NAVBAR HEADER */}
        <header className="h-16 border-b border-slate-900 flex items-center justify-between px-6 bg-slate-950/50 backdrop-blur shrink-0">
          <div className="flex items-center gap-4 min-w-0">
            <span className="font-semibold text-slate-200 truncate">
              {sessions.find(s => s.id === activeSessionId)?.title || 'No active conversation'}
            </span>
            
            {/* RAG Loaded Documents List */}
            {activeSessionId && (
              <div className="hidden md:flex items-center gap-1.5 overflow-x-auto max-w-xs py-1">
                {sessionDocuments.map((doc, idx) => (
                  <span key={idx} className="flex items-center gap-1 text-[10px] bg-slate-900 border border-slate-800 px-2.5 py-0.5 rounded-full text-slate-400 font-medium whitespace-nowrap">
                    <FileText className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                    {doc}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            {/* Document Uploader */}
            {activeSessionId && (
              <div className="flex items-center">
                <input
                  type="file"
                  id="rag-file-upload"
                  accept=".pdf,.txt,.md"
                  onChange={handleFileUpload}
                  className="hidden"
                  disabled={isUploading || isGenerating}
                />
                <label
                  htmlFor="rag-file-upload"
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium cursor-pointer transition-all ${
                    isUploading 
                      ? 'bg-slate-900 border-slate-800 text-slate-500' 
                      : 'bg-slate-900 border-slate-800 hover:border-violet-500/50 text-slate-300'
                  }`}
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-500" />
                      <span>Vectorizing...</span>
                    </>
                  ) : (
                    <>
                      <Paperclip className="w-3.5 h-3.5 text-violet-400" />
                      <span>Attach PDF/Text</span>
                    </>
                  )}
                </label>
              </div>
            )}

            {/* Model Selection Dropdown */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500 font-medium font-mono uppercase">Model:</label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={isGenerating}
                className="bg-slate-900 border border-slate-800 rounded-lg text-sm px-3 py-1.5 focus:outline-none focus:border-violet-500 cursor-pointer disabled:opacity-50"
              >
                {models.length === 0 ? (
                  <option>No models found</option>
                ) : (
                  models.map(m => <option key={m} value={m}>{m}</option>)
                )}
              </select>
            </div>
          </div>
        </header>

        {/* Settings panel (System instructions drawer) */}
        {showSettings && (
          <div className="bg-slate-900/60 border-b border-slate-800/80 p-4 transition-all animate-fadeIn">
            <h3 className="text-sm font-semibold text-slate-300 mb-2">Custom System Prompt</h3>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="e.g. You are a concise coding assistant that speaks Spanish..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg text-sm p-3 text-slate-300 focus:outline-none focus:border-violet-500"
              rows={2}
            />
          </div>
        )}

        {/* CHAT BUBBLE VIEW CONTAINER */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {!activeSessionId ? (
            // State: No active session
            <div className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto">
              <Bot className="w-16 h-16 text-violet-500 mb-4 animate-bounce" />
              <h2 className="text-2xl font-bold mb-2">Create a Session</h2>
              <p className="text-slate-400 text-sm">
                Click the **New Chat** button in the sidebar to start your local privacy-first assistant.
              </p>
            </div>
          ) : messages.length === 0 ? (
            // State: Fresh conversation, show Quick Prompt Suggestions
            <div className="h-full flex flex-col justify-center max-w-2xl mx-auto space-y-8">
              <div className="text-center">
                <Sparkles className="w-12 h-12 text-violet-500 mx-auto mb-4" />
                <h1 className="text-3xl font-extrabold tracking-tight mb-2">What shall we build today?</h1>
                <p className="text-slate-400 text-sm">
                  Powered by Llama 3.2 running 100% locally on your machine.
                </p>
              </div>

              {/* Suggestion Cards */}
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => handleQuickPrompt('Write a clean Python script to scrape a website and save data to SQLite.')}
                  className="text-left p-4 rounded-xl bg-slate-900/40 border border-slate-800/60 hover:bg-slate-900/90 hover:border-violet-500/50 transition-all duration-300 group"
                >
                  <h3 className="font-semibold text-slate-200 group-hover:text-violet-400 mb-1">Code SQLite Scraper</h3>
                  <p className="text-xs text-slate-400">Scrape pages in Python and output a database connection.</p>
                </button>

                <button
                  onClick={() => handleQuickPrompt('Explain quantum computing and superposition in a simple, engaging way.')}
                  className="text-left p-4 rounded-xl bg-slate-900/40 border border-slate-800/60 hover:bg-slate-900/90 hover:border-violet-500/50 transition-all duration-300 group"
                >
                  <h3 className="font-semibold text-slate-200 group-hover:text-violet-400 mb-1">Explain Quantum Physics</h3>
                  <p className="text-xs text-slate-400">Break down superposition using analogies.</p>
                </button>

                <button
                  onClick={() => handleQuickPrompt('Compare SQL and NoSQL databases. When should I choose one over the other?')}
                  className="text-left p-4 rounded-xl bg-slate-900/40 border border-slate-800/60 hover:bg-slate-900/90 hover:border-violet-500/50 transition-all duration-300 group"
                >
                  <h3 className="font-semibold text-slate-200 group-hover:text-violet-400 mb-1">SQL vs NoSQL</h3>
                  <p className="text-xs text-slate-400">A clear framework for backend database decision making.</p>
                </button>

                <button
                  onClick={() => handleQuickPrompt('Write a beautiful CSS glassmorphic panel style using vanilla code.')}
                  className="text-left p-4 rounded-xl bg-slate-900/40 border border-slate-800/60 hover:bg-slate-900/90 hover:border-violet-500/50 transition-all duration-300 group"
                >
                  <h3 className="font-semibold text-slate-200 group-hover:text-violet-400 mb-1">CSS Glassmorphism</h3>
                  <p className="text-xs text-slate-400">Quick recipe for transparent modern layouts.</p>
                </button>
              </div>
            </div>
          ) : (
            // State: Active Chat bubbles list
            <div className="max-w-3xl mx-auto space-y-6">
              {messages.map((msg, index) => (
                <div
                  key={index}
                  className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {/* Avatar Icon */}
                  {msg.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center shrink-0">
                      <Bot className="w-5 h-5 text-violet-400" />
                    </div>
                  )}

                  {/* Message Bubble Container */}
                  <div
                    className={`max-w-xl px-4 py-3 rounded-2xl text-sm leading-relaxed border shadow-sm ${
                      msg.role === 'user'
                        ? 'bg-slate-800 border-slate-700 text-slate-100 rounded-tr-none'
                        : 'bg-slate-900/80 border-slate-800/80 text-slate-200 rounded-tl-none prose prose-invert max-w-none'
                    }`}
                  >
                    {msg.role === 'user' ? (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    ) : (
                      // Render AI output as Markdown with react-markdown
                      <ReactMarkdown
                        components={{
                          code({ node, inline, className, children, ...props }) {
                            const match = /language-(\w+)/.exec(className || '');
                            return !inline ? (
                              <pre className="bg-slate-950 p-3 rounded-lg overflow-x-auto border border-slate-800 font-mono text-xs my-2 text-emerald-400">
                                <code className={className} {...props}>
                                  {children}
                                </code>
                              </pre>
                            ) : (
                              <code className="bg-slate-950 text-pink-400 px-1 py-0.5 rounded font-mono text-xs" {...props}>
                                {children}
                              </code>
                            );
                          }
                        }}
                      >
                        {msg.content || '...'}
                      </ReactMarkdown>
                    )}
                  </div>

                  {msg.role === 'user' && (
                    <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                      <User className="w-5 h-5 text-slate-400" />
                    </div>
                  )}
                </div>
              ))}
              
              {/* Thinking Indicator */}
              {isGenerating && messages[messages.length - 1]?.content === '' && (
                <div className="flex gap-4 justify-start">
                  <div className="w-8 h-8 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center shrink-0">
                    <Bot className="w-5 h-5 text-violet-400 animate-spin" />
                  </div>
                  <div className="max-w-xl px-4 py-3 rounded-2xl text-sm bg-slate-900/80 border-slate-800/80 text-slate-400 rounded-tl-none italic">
                    LocalMind is thinking...
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* BOTTOM INPUT BAR */}
        <footer className="p-6 border-t border-slate-900 bg-slate-950/50 backdrop-blur max-w-3xl w-full mx-auto">
          <div className="relative flex items-center bg-slate-900 border border-slate-800 rounded-2xl focus-within:border-violet-500 transition-all p-1.5">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder={activeSessionId ? "Ask anything... (Enter to send, Shift+Enter for new line)" : "Please select or create a session first"}
              disabled={!activeSessionId}
              rows={1}
              className="flex-1 bg-transparent resize-none focus:outline-none pl-4 pr-12 text-sm text-slate-200 placeholder-slate-500 max-h-36 py-2"
            />

            {/* Action buttons (Send or Stop streaming) */}
            <div className="absolute right-3 flex items-center gap-2">
              {isGenerating ? (
                <button
                  type="button"
                  onClick={handleStopGeneration}
                  className="bg-red-600 hover:bg-red-500 text-white p-2 rounded-xl transition-all shadow-md active:scale-95"
                  title="Stop generation"
                >
                  <Square className="w-4 h-4 fill-white" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSendMessage()}
                  disabled={!activeSessionId || !input.trim()}
                  className="bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:hover:bg-violet-600 text-white p-2 rounded-xl transition-all shadow-md active:scale-95 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          <div className="text-center mt-2 text-[10px] text-slate-600">
            LocalMind operates offline. Conversations are stored securely in local database.
          </div>
        </footer>
      </main>
    </div>
  );
}
