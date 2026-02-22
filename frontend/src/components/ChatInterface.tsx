'use client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useState, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { ImagePlus, X, Plus, MessageSquare, ChevronLeft, BookOpen } from 'lucide-react';

type SourceNode = { text: string; score: number; metadata: Record<string, string | number> };
type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  image?: string;
  sources?: SourceNode[];
};
type ChatSession = { id: string; title: string; messages: Message[]; createdAt: number };

const STORAGE_KEY = 'golivebuddy_sessions';
const SOURCE_MARKER_START = '__SOURCES__';
const SOURCE_MARKER_END = '__END_SOURCES__';

function loadSessions(): ChatSession[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveSessions(s: ChatSession[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { }
}
function newId() { return `sess_${Date.now()}`; }

export default function ChatInterface() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [techCategory, setTechCategory] = useState('sap-pack');
  const [panelSources, setPanelSources] = useState<SourceNode[] | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Boot: load saved sessions
  useEffect(() => {
    const loaded = loadSessions();
    setSessions(loaded);
    if (loaded.length > 0) {
      const last = loaded[loaded.length - 1];
      setActiveId(last.id);
      setMessages(last.messages);
    } else {
      createSession(loaded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Persist messages whenever they change
  useEffect(() => {
    if (!activeId) return;
    setSessions(prev => {
      const updated = prev.map(s => s.id === activeId ? { ...s, messages } : s);
      saveSessions(updated);
      return updated;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  function createSession(base?: ChatSession[]) {
    const list = base ?? sessions;
    const id = newId();
    const sess: ChatSession = { id, title: 'New Chat', messages: [], createdAt: Date.now() };
    const updated = [...list, sess];
    setSessions(updated);
    saveSessions(updated);
    setActiveId(id);
    setMessages([]);
    setInput('');
    setImagePreview(null);
    setPanelSources(null);
    setIsPanelOpen(false);
  }

  function selectSession(id: string) {
    const s = sessions.find(s => s.id === id);
    if (!s) return;
    setActiveId(id);
    setMessages(s.messages);
    setPanelSources(null);
    setIsPanelOpen(false);
  }

  function deleteSession(id: string) {
    const updated = sessions.filter(s => s.id !== id);
    saveSessions(updated);
    setSessions(updated);
    if (activeId === id) {
      if (updated.length > 0) {
        const last = updated[updated.length - 1];
        setActiveId(last.id);
        setMessages(last.messages);
      } else {
        createSession(updated);
      }
    }
  }

  const onDrop = (files: File[]) => {
    if (!files[0]) return;
    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(files[0]);
  };
  const { getRootProps, getInputProps } = useDropzone({ onDrop, accept: { 'image/*': [] }, maxFiles: 1 });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && !imagePreview) || isSending) return;

    const currentInput = input;
    const currentImage = imagePreview;
    setInput('');
    setImagePreview(null);
    setIsSending(true);

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: currentInput,
      ...(currentImage && { image: currentImage }),
    };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);

    // Name session from first user message
    if (messages.length === 0 && currentInput.trim()) {
      setSessions(prev => {
        const updated = prev.map(s =>
          s.id === activeId
            ? { ...s, title: currentInput.slice(0, 45) + (currentInput.length > 45 ? '…' : '') }
            : s
        );
        saveSessions(updated);
        return updated;
      });
    }

    const assistantId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }]);

    try {
      const endpoint = currentImage ? '/api/analyze_image' : '/api/chat';
      const body = currentImage
        ? { messages: newMessages, namespace: techCategory, image: currentImage }
        : { messages: newMessages, namespace: techCategory };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('API failed');

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Check if the buffer contains the sources marker
          const startIdx = buffer.indexOf(SOURCE_MARKER_START);
          if (startIdx !== -1) {
            const endIdx = buffer.indexOf(SOURCE_MARKER_END, startIdx);
            if (endIdx !== -1) {
              // We have the full sources block — extract it
              const textPart = buffer.slice(0, startIdx);
              const jsonStr = buffer.slice(startIdx + SOURCE_MARKER_START.length, endIdx);
              buffer = buffer.slice(endIdx + SOURCE_MARKER_END.length);

              try {
                const sourcesData: SourceNode[] = JSON.parse(jsonStr);
                // Attach sources to the assistant message
                setMessages(prev =>
                  prev.map(m => m.id === assistantId
                    ? { ...m, content: m.content + textPart, sources: sourcesData }
                    : m)
                );
                continue;
              } catch { /* parse failed, treat as normal text */ }
            }
          }

          // Normal text chunk — render immediately
          if (!buffer.includes(SOURCE_MARKER_START)) {
            const chunk = buffer;
            buffer = '';
            setMessages(prev =>
              prev.map(m => m.id === assistantId ? { ...m, content: m.content + chunk } : m)
            );
          }
        }

        // Flush any remaining buffer (shouldn't normally happen)
        if (buffer && !buffer.includes(SOURCE_MARKER_START)) {
          setMessages(prev =>
            prev.map(m => m.id === assistantId ? { ...m, content: m.content + buffer } : m)
          );
        }
      }
    } catch (err) {
      console.error(err);
      setInput(currentInput);
      if (currentImage) setImagePreview(currentImage);
    } finally {
      setIsSending(false);
    }
  };

  function openSources(sources: SourceNode[]) {
    setPanelSources(sources);
    setIsPanelOpen(true);
  }

  const activeSession = sessions.find(s => s.id === activeId);

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden font-sans">

      {/* ── Sidebar ── */}
      <aside className={`flex flex-col shrink-0 bg-[#F7F5FF] border-r border-primary/10 transition-all duration-300 overflow-hidden ${isSidebarOpen ? 'w-64' : 'w-0'}`}>
        <div className="flex items-center justify-between px-4 py-5 border-b border-primary/10">
          <span className="text-xs font-bold text-primary tracking-widest uppercase">Chat History</span>
          <button onClick={() => createSession()} className="flex items-center gap-1 bg-primary text-primary-foreground rounded-full px-3 py-1.5 text-xs font-semibold hover:bg-primary/90 transition-colors">
            <Plus size={12} /> New
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {sessions.length === 0 && <p className="text-xs text-muted-foreground px-4 py-6 text-center">No chats yet.</p>}
          {[...sessions].reverse().map(sess => (
            <div
              key={sess.id}
              onClick={() => selectSession(sess.id)}
              className={`group flex items-center gap-2 px-3 py-2.5 cursor-pointer rounded-lg mx-2 mb-1 transition-colors text-sm ${sess.id === activeId ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-primary/5 text-foreground'}`}
            >
              <MessageSquare size={13} className="shrink-0 opacity-50" />
              <span className="flex-1 truncate">{sess.title}</span>
              <button
                onClick={e => { e.stopPropagation(); deleteSession(sess.id); }}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
              ><X size={12} /></button>
            </div>
          ))}
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">

        {/* Header */}
        <header className="shrink-0 flex items-center justify-between px-6 py-4 border-b bg-background/95 backdrop-blur">
          <div className="flex items-center gap-3">
            <button onClick={() => setIsSidebarOpen(o => !o)} className="text-primary/50 hover:text-primary p-1.5 rounded-md hover:bg-primary/5 transition-colors">
              <ChevronLeft size={20} className={`transition-transform duration-300 ${isSidebarOpen ? '' : 'rotate-180'}`} />
            </button>
            <div>
              <h1 className="text-2xl font-extrabold text-primary tracking-tight leading-none">Go-Live Buddy</h1>
              <p className="text-muted-foreground text-xs mt-0.5">{activeSession?.title !== 'New Chat' ? activeSession?.title : 'Premium Multi-Tech AI Knowledge Portal'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-card px-4 py-2 border rounded-full shadow-sm">
              <span className="text-sm font-semibold text-foreground">Viewing:</span>
              <select value={techCategory} onChange={e => setTechCategory(e.target.value)} className="bg-transparent border-none text-sm font-bold text-primary focus:outline-none cursor-pointer">
                <option value="sap-pack">SAP FI</option>
                <option value="crm-pack">Salesforce CRM</option>
              </select>
            </div>
            <button onClick={() => createSession()} className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded-full px-4 py-2 text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm">
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
                <p className="text-lg font-medium">Ask me about {techCategory === 'sap-pack' ? 'SAP Fiori' : 'Salesforce CRM'}!</p>
                <p className="text-sm mt-2 text-muted-foreground/70">
                  {techCategory === 'sap-pack'
                    ? 'Try: "How do I change the theme in SAP Fiori Launchpad?"'
                    : 'Try: "How do I convert a lead in Salesforce?"'}
                </p>
              </div>
            )}
            {messages.map(m => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`px-5 py-4 rounded-2xl max-w-[85%] shadow-sm ${m.role === 'user'
                  ? 'bg-primary text-primary-foreground rounded-br-sm'
                  : 'bg-[#F1F1EF] text-[#000000] border border-[#CFCFCF] rounded-bl-sm'}`}
                >
                  {m.image && (
                    <div className="mb-3 p-2 bg-black/10 rounded-lg inline-block">
                      <div className="text-xs font-bold mb-2 flex items-center gap-1 uppercase tracking-wider opacity-90"><span>👁️</span> Vision Analysis</div>
                      <img src={m.image} alt="User upload" className="max-w-[240px] rounded border shadow-sm" />
                    </div>
                  )}
                  <p className="whitespace-pre-wrap leading-relaxed text-sm">
                    {typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}
                  </p>
                  {/* Only show View Source if we have real matched sources */}
                  {m.role === 'assistant' && m.sources && m.sources.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-[#CFCFCF] flex justify-end">
                      <button
                        onClick={() => openSources(m.sources!)}
                        className="text-xs font-semibold text-primary hover:underline flex items-center gap-1.5"
                      >
                        <BookOpen size={12} />
                        View Source ({m.sources.length} match{m.sources.length > 1 ? 'es' : ''})
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
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className="shrink-0 px-6 py-4 border-t bg-background/95 backdrop-blur">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-4xl mx-auto">
            {imagePreview && (
              <div className="relative inline-block w-20 h-20 border-2 border-primary/20 rounded-xl overflow-hidden shadow-sm self-start ml-16">
                <img src={imagePreview} alt="preview" className="object-cover w-full h-full" />
                <button type="button" onClick={() => setImagePreview(null)} className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 hover:bg-black/80">
                  <X size={12} />
                </button>
              </div>
            )}
            <div className="flex gap-3 items-center">
              <div {...getRootProps()} className="cursor-pointer border-2 border-dashed border-primary/30 rounded-full hover:bg-primary/5 hover:border-primary/60 transition-colors flex items-center justify-center h-14 w-14 shrink-0 group" title="Upload Screenshot">
                <input {...getInputProps()} />
                <ImagePlus className="w-6 h-6 text-primary/70 group-hover:text-primary transition-colors" />
              </div>
              <Input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleSubmit(e as unknown as React.FormEvent); }}
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

      {/* ── Source Panel ── */}
      <div className={`fixed top-0 right-0 w-[420px] h-full bg-white border-l shadow-2xl flex flex-col transform transition-transform duration-300 z-50 ${isPanelOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex justify-between items-center px-6 py-5 border-b shrink-0">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <BookOpen size={18} className="text-primary" /> Source Citations
          </h2>
          <button onClick={() => setIsPanelOpen(false)} className="text-muted-foreground hover:text-foreground"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {!panelSources || panelSources.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center mt-8">No source citations available for this response.</p>
          ) : (
            panelSources.map((src, i) => (
              <div key={i} className="border border-border rounded-xl p-4 bg-[#FAFAFA] flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-primary uppercase tracking-wider">
                    {src.metadata?.type === 'jira_ticket' ? '🎫 JIRA Ticket' : '🎬 Video Frame'}
                    {src.metadata?.frame_index != null ? ` #${src.metadata.frame_index}` : ''}
                  </span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${src.score >= 0.7 ? 'bg-green-100 text-green-700' :
                      src.score >= 0.5 ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-600'
                    }`}>
                    {Math.round(src.score * 100)}% match
                  </span>
                </div>
                <p className="text-sm text-foreground leading-relaxed line-clamp-6">{src.text}</p>
                {src.metadata?.source && (
                  <a
                    href={src.metadata.source as string}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary/70 hover:text-primary hover:underline truncate"
                  >
                    🔗 {src.metadata.source}
                  </a>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {isPanelOpen && (
        <div className="fixed inset-0 bg-black/20 z-40 lg:hidden" onClick={() => setIsPanelOpen(false)} />
      )}
    </div>
  );
}
