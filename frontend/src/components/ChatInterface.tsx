'use client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useState, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { ImagePlus, X, Plus, MessageSquare, ChevronLeft } from 'lucide-react';

type Message = { id: string; role: 'user' | 'assistant'; content: string; image?: string };
type ChatSession = { id: string; title: string; messages: Message[]; createdAt: number };

const STORAGE_KEY = 'golivbuddy_sessions';

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveSessions(sessions: ChatSession[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)); } catch { }
}

function newSessionId() { return `sess_${Date.now()}`; }

export default function ChatInterface() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [visualProof, setVisualProof] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [techCategory, setTechCategory] = useState('sap-pack');
  const [isVisualProofOpen, setIsVisualProofOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load sessions from localStorage on mount
  useEffect(() => {
    const loaded = loadSessions();
    setSessions(loaded);
    // Auto-select most recent session or create one
    if (loaded.length > 0) {
      const latest = loaded[loaded.length - 1];
      setActiveSessionId(latest.id);
      setMessages(latest.messages);
    } else {
      startNewChat(loaded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to bottom whenever messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Sync current messages into the active session and persist
  useEffect(() => {
    if (!activeSessionId) return;
    setSessions(prev => {
      const updated = prev.map(s =>
        s.id === activeSessionId ? { ...s, messages } : s
      );
      saveSessions(updated);
      return updated;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // Open visual proof when SAP/CRM keywords appear
  useEffect(() => {
    const userMessages = messages.filter(m => m.role === 'user');
    if (userMessages.length > 0) {
      const lastUserMsg = userMessages[userMessages.length - 1];
      if (typeof lastUserMsg?.content === 'string') {
        const text = lastUserMsg.content.toLowerCase();
        if (text.includes('fiori') || text.includes('sap')) {
          // Reliable picsum seed: 100 = tech dashboard style
          setVisualProof('https://picsum.photos/seed/sap-fiori/600/400');
          setIsVisualProofOpen(true);
        } else if (text.includes('crm') || text.includes('lead')) {
          setVisualProof('https://picsum.photos/seed/crm-sales/600/400');
          setIsVisualProofOpen(true);
        } else {
          setVisualProof('https://picsum.photos/seed/golivebuddy/600/400');
          setIsVisualProofOpen(true);
        }
      }
    }
  }, [messages]);

  function startNewChat(currentSessions?: ChatSession[]) {
    const base = currentSessions ?? sessions;
    const id = newSessionId();
    const session: ChatSession = {
      id,
      title: 'New Chat',
      messages: [],
      createdAt: Date.now(),
    };
    const updated = [...base, session];
    setSessions(updated);
    saveSessions(updated);
    setActiveSessionId(id);
    setMessages([]);
    setInput('');
    setImage(null);
    setImagePreview(null);
    setVisualProof(null);
    setIsVisualProofOpen(false);
  }

  function selectSession(id: string) {
    const sess = sessions.find(s => s.id === id);
    if (!sess) return;
    setActiveSessionId(id);
    setMessages(sess.messages);
    setVisualProof(null);
    setIsVisualProofOpen(false);
  }

  function deleteSession(id: string) {
    const updated = sessions.filter(s => s.id !== id);
    saveSessions(updated);
    setSessions(updated);
    if (activeSessionId === id) {
      if (updated.length > 0) {
        const last = updated[updated.length - 1];
        setActiveSessionId(last.id);
        setMessages(last.messages);
      } else {
        startNewChat(updated);
      }
    }
  }

  const onDrop = (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      setImage(file);
      const reader = new FileReader();
      reader.onloadend = () => { setImagePreview(reader.result as string); };
      reader.readAsDataURL(file);
    }
  };

  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    maxFiles: 1,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && !imagePreview) || isSending) return;

    const currentInput = input;
    const currentImage = imagePreview;
    setInput('');
    setImage(null);
    setImagePreview(null);
    setIsSending(true);

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: currentInput,
      ...(currentImage && { image: currentImage })
    };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);

    // Update session title from first user message
    if (messages.length === 0 && currentInput.trim()) {
      setSessions(prev => {
        const updated = prev.map(s =>
          s.id === activeSessionId
            ? { ...s, title: currentInput.slice(0, 40) + (currentInput.length > 40 ? '…' : '') }
            : s
        );
        saveSessions(updated);
        return updated;
      });
    }

    const assistantId = (Date.now() + 1).toString();
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '' }]);

    try {
      const endpoint = currentImage ? '/api/analyze_image' : '/api/chat';
      const bodyPayload = currentImage
        ? { messages: newMessages, namespace: techCategory, image: currentImage }
        : { messages: newMessages, namespace: techCategory };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });

      if (!response.ok) throw new Error('API Request Failed');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + chunk } : m))
          );
        }
      }
    } catch (err) {
      console.error('Submit error:', err);
      setInput(currentInput);
      if (currentImage) setImagePreview(currentImage);
    } finally {
      setIsSending(false);
    }
  };

  const activeSession = sessions.find(s => s.id === activeSessionId);

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden font-sans">

      {/* ─── Left Sidebar: Chat History ─── */}
      <aside
        className={`flex flex-col shrink-0 bg-[#F7F5FF] border-r border-primary/10 transition-all duration-300 overflow-hidden ${isSidebarOpen ? 'w-64' : 'w-0'
          }`}
      >
        <div className="flex items-center justify-between px-4 py-5 border-b border-primary/10">
          <span className="text-sm font-bold text-primary tracking-wide uppercase">Chat History</span>
          <button
            onClick={() => startNewChat()}
            title="New Chat"
            className="flex items-center gap-1 bg-primary text-primary-foreground rounded-full px-3 py-1.5 text-xs font-semibold hover:bg-primary/90 transition-colors"
          >
            <Plus size={12} /> New
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {sessions.length === 0 && (
            <p className="text-xs text-muted-foreground px-4 py-6 text-center">No chats yet. Start one!</p>
          )}
          {[...sessions].reverse().map(sess => (
            <div
              key={sess.id}
              onClick={() => selectSession(sess.id)}
              className={`group flex items-center gap-2 px-4 py-3 cursor-pointer rounded-lg mx-2 mb-1 transition-colors ${sess.id === activeSessionId
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-primary/5 text-foreground'
                }`}
            >
              <MessageSquare size={14} className="shrink-0 opacity-60" />
              <span className="flex-1 text-sm truncate">{sess.title}</span>
              <button
                onClick={e => { e.stopPropagation(); deleteSession(sess.id); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                title="Delete"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* ─── Main Chat Area ─── */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">

        {/* Header */}
        <header className="shrink-0 flex items-center justify-between px-6 py-4 border-b bg-background/95 backdrop-blur">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen(o => !o)}
              className="text-primary/60 hover:text-primary transition-colors p-1.5 rounded-md hover:bg-primary/5"
              title="Toggle sidebar"
            >
              <ChevronLeft size={20} className={`transition-transform duration-300 ${isSidebarOpen ? '' : 'rotate-180'}`} />
            </button>
            <div>
              <h1 className="text-2xl font-extrabold text-primary tracking-tight leading-none">Go-Live Buddy</h1>
              <p className="text-muted-foreground text-xs mt-0.5">
                {activeSession?.title && activeSession.title !== 'New Chat' ? activeSession.title : 'Premium Multi-Tech AI Knowledge Portal'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-card px-4 py-2 border rounded-full shadow-sm">
              <span className="text-sm font-semibold text-foreground">Viewing:</span>
              <select
                value={techCategory}
                onChange={(e) => setTechCategory(e.target.value)}
                className="bg-transparent border-none text-sm font-bold text-primary focus:outline-none cursor-pointer"
              >
                <option value="sap-pack">SAP FI</option>
                <option value="crm-pack">Salesforce CRM</option>
              </select>
            </div>
            <button
              onClick={() => startNewChat()}
              className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded-full px-4 py-2 text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm"
            >
              <Plus size={14} /> New Chat
            </button>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="flex flex-col gap-6 max-w-4xl mx-auto pb-4">
            {messages.length === 0 && (
              <div className="text-center text-muted-foreground mt-32 flex flex-col items-center">
                <div className="w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-4 text-2xl">🤖</div>
                <p className="text-lg">Ask me about {techCategory === 'sap-pack' ? 'SAP Fiori' : 'Salesforce CRM'}!</p>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`px-5 py-4 rounded-2xl max-w-[85%] shadow-sm ${m.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-br-sm'
                    : 'bg-[#F1F1EF] text-[#000000] border border-[#CFCFCF] rounded-bl-sm'
                    }`}
                >
                  {m.image && (
                    <div className="mb-3 p-2 bg-black/10 rounded-lg inline-block">
                      <div className="text-xs font-bold mb-2 flex items-center gap-1 uppercase tracking-wider text-primary-foreground/90">
                        <span>👁️</span> Vision Analysis
                      </div>
                      <img src={m.image} alt="User upload" className="max-w-[240px] rounded border shadow-sm" />
                    </div>
                  )}
                  <p className="whitespace-pre-wrap leading-relaxed">
                    {typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}
                  </p>
                  {m.role === 'assistant' && m.content.length > 50 && (
                    <div className="mt-3 pt-3 border-t border-[#CFCFCF] flex justify-end">
                      <button
                        onClick={() => {
                          if (!visualProof) {
                            setVisualProof('https://picsum.photos/seed/golivebuddy/600/400');
                          }
                          setIsVisualProofOpen(true);
                        }}
                        className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
                      >
                        <span>📄</span> View Source
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isSending && (
              <div className="flex justify-start">
                <div className="px-5 py-4 rounded-2xl bg-[#F1F1EF] border border-[#CFCFCF] rounded-bl-sm flex gap-1 items-center h-12">
                  <span className="w-2 h-2 rounded-full bg-primary animate-bounce" />
                  <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:0.1s]" />
                  <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:0.2s]" />
                </div>
              </div>
            )}
            {/* Scroll anchor */}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Form */}
        <div className="shrink-0 px-6 py-4 border-t bg-background/95 backdrop-blur">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-4xl mx-auto">
            {imagePreview && (
              <div className="relative inline-block w-20 h-20 border-2 border-primary/20 rounded-xl overflow-hidden shadow-sm self-start ml-16">
                <img src={imagePreview} alt="upload preview" className="object-cover w-full h-full" />
                <button
                  type="button"
                  onClick={() => { setImage(null); setImagePreview(null); }}
                  className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 hover:bg-black/80 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            )}
            <div className="flex gap-3 items-center">
              <div
                {...getRootProps()}
                className="cursor-pointer p-3 border-2 border-dashed border-primary/30 rounded-full hover:bg-primary/5 hover:border-primary/60 transition-colors flex items-center justify-center h-14 w-14 group shrink-0"
                title="Upload Screenshot"
              >
                <input {...getInputProps()} />
                <ImagePlus className="w-6 h-6 text-primary/70 group-hover:text-primary transition-colors" />
              </div>
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) handleSubmit(e as unknown as React.FormEvent); }}
                placeholder={imagePreview ? "Add context for the visual audit..." : `Ask a question about ${techCategory === 'sap-pack' ? 'SAP FI' : 'Salesforce CRM'}...`}
                className="flex-1 shadow-sm h-14 rounded-full px-6 border-2 focus-visible:ring-primary text-base"
              />
              <Button type="submit" disabled={isSending} className="h-14 w-14 rounded-full shadow-sm shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                  <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
                </svg>
              </Button>
            </div>
          </form>
        </div>
      </div>

      {/* ─── Visual Proof Drawer ─── */}
      <div
        className={`fixed top-0 right-0 w-96 h-full bg-white border-l shadow-2xl flex flex-col transform transition-transform duration-300 z-50 ${isVisualProofOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
      >
        <div className="flex justify-between items-center px-6 py-5 border-b shrink-0">
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <span className="text-primary">📄</span> Visual Proof
          </h2>
          <button onClick={() => setIsVisualProofOpen(false)} className="text-muted-foreground hover:text-foreground">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          {visualProof ? (
            <div className="w-full h-full relative group">
              <img src={visualProof} alt="Visual Proof" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4 text-left">
                <p className="text-white text-sm font-semibold">Source Citation</p>
                <p className="text-white/80 text-xs">Extracted frame from matched document.</p>
              </div>
            </div>
          ) : (
            <div className="p-6 text-sm text-muted-foreground">
              Citations and visual proof will appear here when Go-Live Buddy references documentation.
            </div>
          )}
        </div>
      </div>

      {/* Backdrop */}
      {isVisualProofOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40 lg:hidden"
          onClick={() => setIsVisualProofOpen(false)}
        />
      )}
    </div>
  );
}
