'use client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useState, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { ImagePlus, X, Plus, MessageSquare, ChevronLeft, BookOpen, ChevronDown, ChevronUp, Target, Ticket } from 'lucide-react';
import dynamic from 'next/dynamic';

const JiraDraftModal = dynamic(() => import('./JiraDraftModal'), { ssr: false });

// ── Types ─────────────────────────────────────────────────────────────────────
type SourceNode = { text: string; score: number; metadata: Record<string, string | number> };
type FocusCoord = { x_pct: number; y_pct: number; w_pct: number; h_pct: number; label: string };
type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  image?: string;
  sources?: SourceNode[];
  focusCoord?: FocusCoord | null;
  helpful?: boolean | null;    // true=👍, false=👎, null=not voted
};
type ChatSession = { id: string; title: string; messages: Message[]; createdAt: number };

// ── Constants ─────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'golivebuddy_sessions';
const SOURCE_MARKER_START = '__SOURCES__';
const SOURCE_MARKER_END = '__END_SOURCES__';
const FOCUS_MARKER_START = '__FOCUS__';
const FOCUS_MARKER_END = '__END_FOCUS__';

const VIDEO_NS_MAP: Record<string, string> = {
  yBNmvqBwUAI: 'sap-pack',
  xLCLrsDcIHk: 'crm-pack',
};

// ── Session helpers ───────────────────────────────────────────────────────────
function loadSessions(): ChatSession[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveSessions(s: ChatSession[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { }
}
function newId() { return `sess_${Date.now()}`; }

// ── Source deduplication ──────────────────────────────────────────────────────
function deduplicateSources(sources: SourceNode[]): SourceNode[] {
  const seenFrame = new Set<number>();
  const seenPage = new Set<string>();
  const seenTicket = new Set<string>();
  return sources.filter(src => {
    const type = src.metadata?.type;
    if (type === 'pdf_document') {
      const pg = String(src.metadata?.page_label ?? '');
      if (seenPage.has(pg)) return false;
      seenPage.add(pg);
      return true;
    }
    if (type === 'jira_ticket') {
      const rawId = String(src.metadata?.ticket_id ?? '');
      const fromTx = src.text.match(/Ticket ID:\s*(\S+)/)?.[1] ?? '';
      const tid = rawId || fromTx || src.text.slice(0, 80);
      if (seenTicket.has(tid)) return false;
      seenTicket.add(tid);
      return true;
    }
    const fi = Number(src.metadata?.frame_index ?? -1);
    if (fi >= 0 && seenFrame.has(fi)) return false;
    seenFrame.add(fi);
    return true;
  });
}

// ── ShowMeOverlay (inline — no extra file import needed for the overlay logic) ─
function ShowMeOverlayInline({ imageUrl, coord }: { imageUrl: string; coord: FocusCoord }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-border shadow-md bg-black">
      <img src={imageUrl} alt="Video frame" className="w-full object-contain block" />
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="absolute transition-all duration-200"
        style={{
          left: `${coord.x_pct}%`, top: `${coord.y_pct}%`,
          width: `${coord.w_pct}%`, height: `${coord.h_pct}%`,
          border: '2.5px solid #7500C0', borderRadius: '6px',
          boxShadow: hovered
            ? '0 0 0 3px #7500C040, 0 0 18px 6px #7500C060'
            : '0 0 0 2px #7500C030, 0 0 10px 3px #7500C040',
          animation: 'pulse-border 2s ease-in-out infinite',
          cursor: 'pointer', zIndex: 10,
        }}
      >
        <div className={`absolute -top-7 left-0 whitespace-nowrap px-2.5 py-1 rounded-full text-xs font-bold
                        text-white pointer-events-none transition-all duration-200 ${hovered ? 'opacity-100' : 'opacity-70'}`}
          style={{ background: '#7500C0', boxShadow: '0 2px 8px #7500C060' }}>
          🎯 {coord.label}
        </div>
        <div className="absolute bottom-1 right-1 w-5 h-5 rounded-full flex items-center justify-center animate-pulse"
          style={{ background: '#7500C0' }}>
          <Target size={10} className="text-white" />
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 px-4 py-2 text-white text-xs font-semibold
                      flex items-center gap-2 backdrop-blur-sm"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)' }}>
        <Target size={12} style={{ color: '#C478FF' }} />
        <span>Click to perform: <em>{coord.label}</em></span>
      </div>
      <style>{`@keyframes pulse-border{0%,100%{box-shadow:0 0 0 2px #7500C030,0 0 10px 3px #7500C040}50%{box-shadow:0 0 0 3px #7500C060,0 0 20px 8px #7500C070}}`}</style>
    </div>
  );
}

// ── Source Card ───────────────────────────────────────────────────────────────
function SourceCard({ src, focusCoord, showOverlay }: { src: SourceNode; focusCoord?: FocusCoord | null; showOverlay?: boolean }) {
  const isVideo = src.metadata?.type !== 'jira_ticket' && src.metadata?.type !== 'pdf_document';
  const isPdf = src.metadata?.type === 'pdf_document';
  const isJira = src.metadata?.type === 'jira_ticket';

  // PDF/JIRA: show full text by default (content is the citation); video: collapse long AI descriptions
  const [expanded, setExpanded] = useState(!isVideo);

  const sourceUrl = src.metadata?.source as string | undefined;
  const frameIndex = src.metadata?.frame_index as number | undefined;
  const pageLabel = src.metadata?.page_label as string | undefined;
  const rawTicketId = src.metadata?.ticket_id as string | undefined;
  const ticketId = rawTicketId || src.text.match(/Ticket ID:\s*(\S+)/)?.[1];
  const ticketSystem = src.metadata?.system as string || src.text.match(/System:\s*(.+)/)?.[1]?.trim();
  const frameImageUrl = src.metadata?.frame_image_url as string | undefined;

  let videoId: string | null = null;
  let timestampSec = 0;
  if (isVideo && sourceUrl) {
    const m = sourceUrl.match(/(?:v=|youtu\.be\/)([^&?/]+)/);
    videoId = m ? m[1] : null;
    timestampSec = (frameIndex ?? 0) * 30;
  }
  const nsFromVideo = videoId ? VIDEO_NS_MAP[videoId] : null;
  const derivedFrameUrl = nsFromVideo !== undefined && frameIndex !== undefined
    ? `/frames/${nsFromVideo}/${frameIndex}.jpg` : null;
  const effectiveFrameUrl = frameImageUrl ?? derivedFrameUrl;
  const videoLink = videoId ? `https://www.youtube.com/watch?v=${videoId}&t=${timestampSec}s` : sourceUrl;
  const scoreColor = src.score >= 0.7 ? 'bg-green-100 text-green-700' : src.score >= 0.5 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600';

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-[#FAFAFA] flex flex-col">
      {/* Visual header */}
      {isVideo && (effectiveFrameUrl || videoId) && !showOverlay && (
        <a href={videoLink ?? '#'} target="_blank" rel="noopener noreferrer" className="relative block group shrink-0">
          <img src={effectiveFrameUrl ?? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
            alt={`Frame ${frameIndex}`} className="w-full h-44 object-cover transition-transform duration-300 group-hover:scale-105" />
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="text-white text-sm font-bold bg-black/60 px-3 py-1.5 rounded-full">
              ▶ Jump to {Math.floor(timestampSec / 60)}:{String(timestampSec % 60).padStart(2, '0')}
            </span>
          </div>
          <div className="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-2 py-0.5 rounded-full font-semibold">
            🎬 Frame {frameIndex ?? '?'} · {Math.floor(timestampSec / 60)}:{String(timestampSec % 60).padStart(2, '0')}
          </div>
        </a>
      )}
      {/* Show Me Overlay replaces normal frame header */}
      {isVideo && showOverlay && effectiveFrameUrl && focusCoord && (
        <div className="p-3">
          <ShowMeOverlayInline
            imageUrl={effectiveFrameUrl ?? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
            coord={focusCoord}
          />
        </div>
      )}
      {isPdf && (
        <a href={sourceUrl ?? '#'} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-3 w-full px-5 py-3 bg-blue-50 hover:bg-blue-100 transition-colors shrink-0">
          <span className="text-2xl shrink-0">📄</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-blue-800 truncate">{sourceUrl?.split('/').pop() ?? 'Document'}</p>
            {pageLabel && <p className="text-xs text-blue-600">Page {pageLabel}</p>}
          </div>
        </a>
      )}
      {isJira && (
        <div className="flex items-center gap-3 w-full px-5 py-3 bg-amber-50 shrink-0">
          <span className="text-2xl shrink-0">🎫</span>
          <div>
            <p className="text-xs font-bold text-amber-800">{ticketId ?? 'JIRA Ticket'}</p>
            <p className="text-xs text-amber-600">{ticketSystem ?? ''}</p>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-primary uppercase tracking-wider">
            {isVideo ? '🎬 Video Frame' : isPdf ? '📄 PDF Document' : '🎫 JIRA Ticket'}
          </span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${scoreColor}`}>
            {Math.round(src.score * 100)}% match
          </span>
        </div>
        {isPdf && pageLabel && <p className="text-xs font-semibold text-blue-600">📖 Page {pageLabel}</p>}
        {isJira && ticketId && <p className="text-xs font-semibold text-amber-700">🎫 {ticketId}</p>}
        {isVideo && frameIndex !== undefined && (
          <p className="text-xs font-semibold text-purple-600">
            ⏱ {Math.floor(timestampSec / 60)}:{String(timestampSec % 60).padStart(2, '0')} into video
          </p>
        )}
        <p className={`text-xs text-foreground leading-relaxed overflow-hidden transition-all ${expanded ? '' : isVideo ? 'line-clamp-4' : 'line-clamp-5'
          }`}>{src.text}</p>
        {src.text.length > 180 && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="self-start mt-0.5 px-3 py-1 rounded-full text-xs font-semibold border transition-all"
            style={{
              borderColor: '#460073',
              color: '#460073',
              background: expanded ? '#46007310' : 'transparent',
            }}
          >
            {expanded
              ? '▲ Collapse'
              : `▼ Expand full ${isPdf ? 'excerpt' : isJira ? 'ticket details' : 'description'}`}
          </button>
        )}
        {isVideo && videoLink && (
          <a href={videoLink} target="_blank" rel="noopener noreferrer" className="text-xs text-primary/70 hover:text-primary hover:underline truncate">
            🔗 Watch at {Math.floor(timestampSec / 60)}:{String(timestampSec % 60).padStart(2, '0')}
          </a>
        )}
        {isPdf && sourceUrl && (
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary/70 hover:text-primary hover:underline truncate">
            🔗 {sourceUrl}
          </a>
        )}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ChatInterface() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [techCategory, setTechCategory] = useState('sap-pack');
  const [panelSources, setPanelSources] = useState<SourceNode[] | null>(null);
  const [panelFocus, setPanelFocus] = useState<FocusCoord | null>(null);
  const [showOverlayInPanel, setShowOverlayInPanel] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [jiraPayload, setJiraPayload] = useState<import('./JiraDraftModal').JiraDraftPayload | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loaded = loadSessions();
    setSessions(loaded);
    if (loaded.length > 0) {
      const last = loaded[loaded.length - 1];
      setActiveId(last.id);
      setMessages(last.messages);
    } else { createSession(loaded); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

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
    setSessions(updated); saveSessions(updated); setActiveId(id); setMessages([]);
    setInput(''); setImagePreview(null); setPanelSources(null); setIsPanelOpen(false);
  }

  function selectSession(id: string) {
    const s = sessions.find(s => s.id === id);
    if (!s) return;
    setActiveId(id); setMessages(s.messages);
    setPanelSources(null); setIsPanelOpen(false);
  }

  function deleteSession(id: string) {
    const updated = sessions.filter(s => s.id !== id);
    saveSessions(updated); setSessions(updated);
    if (activeId === id) {
      if (updated.length > 0) { const last = updated[updated.length - 1]; setActiveId(last.id); setMessages(last.messages); }
      else createSession(updated);
    }
  }

  function markHelpful(msgId: string, value: boolean) {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, helpful: value } : m));
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
    setInput(''); setImagePreview(null); setIsSending(true);

    const userMsg: Message = {
      id: Date.now().toString(), role: 'user', content: currentInput,
      ...(currentImage && { image: currentImage }),
    };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);

    if (messages.length === 0 && currentInput.trim()) {
      setSessions(prev => {
        const updated = prev.map(s => s.id === activeId
          ? { ...s, title: currentInput.slice(0, 45) + (currentInput.length > 45 ? '…' : '') } : s);
        saveSessions(updated); return updated;
      });
    }

    const assistantId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', helpful: null }]);

    try {
      const endpoint = currentImage ? '/api/analyze_image' : '/api/chat';
      const body = currentImage
        ? { messages: newMessages, namespace: techCategory, image: currentImage }
        : { messages: newMessages, namespace: techCategory };
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error('API failed');

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // ── Extract __SOURCES__ ──────────────────────────────────────────
          const si = buffer.indexOf(SOURCE_MARKER_START);
          if (si !== -1) {
            const ei = buffer.indexOf(SOURCE_MARKER_END, si);
            if (ei !== -1) {
              const textPart = buffer.slice(0, si);
              const jsonStr = buffer.slice(si + SOURCE_MARKER_START.length, ei);
              buffer = buffer.slice(ei + SOURCE_MARKER_END.length);
              try {
                const raw: SourceNode[] = JSON.parse(jsonStr);
                const deduped = deduplicateSources(raw);
                setMessages(prev => prev.map(m => m.id === assistantId
                  ? { ...m, content: m.content + textPart, sources: deduped } : m));
                continue;
              } catch { /* fall through */ }
            }
          }

          // ── Extract __FOCUS__ ────────────────────────────────────────────
          const fi = buffer.indexOf(FOCUS_MARKER_START);
          if (fi !== -1) {
            const fei = buffer.indexOf(FOCUS_MARKER_END, fi);
            if (fei !== -1) {
              const jsonStr = buffer.slice(fi + FOCUS_MARKER_START.length, fei);
              buffer = buffer.slice(fei + FOCUS_MARKER_END.length);
              try {
                const coord: FocusCoord = JSON.parse(jsonStr);
                setMessages(prev => prev.map(m => m.id === assistantId
                  ? { ...m, focusCoord: coord } : m));
                continue;
              } catch { /* fall through */ }
            }
          }

          if (!buffer.includes(SOURCE_MARKER_START) && !buffer.includes(FOCUS_MARKER_START)) {
            const chunk = buffer; buffer = '';
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: m.content + chunk } : m));
          }
        }
        if (buffer && !buffer.includes(SOURCE_MARKER_START) && !buffer.includes(FOCUS_MARKER_START)) {
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: m.content + buffer } : m));
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

  function openSources(sources: SourceNode[], focusCoord?: FocusCoord | null, withOverlay = false) {
    setPanelSources(sources);
    setPanelFocus(focusCoord ?? null);
    setShowOverlayInPanel(withOverlay);
    setIsPanelOpen(true);
  }

  function openJiraDraft(msg: Message) {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const systemCtx = techCategory === 'sap-pack' ? 'SAP FI (S/4HANA Cloud)' : 'Salesforce CRM';
    setJiraPayload({
      subject: lastUser?.content.slice(0, 120) ?? 'Support Request',
      description: msg.content.slice(0, 800),
      priority: 'Medium',
      systemContext: systemCtx,
      namespace: techCategory,
    });
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
            <div key={sess.id} onClick={() => selectSession(sess.id)}
              className={`group flex items-center gap-2 px-3 py-2.5 cursor-pointer rounded-lg mx-2 mb-1 transition-colors text-sm ${sess.id === activeId ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-primary/5 text-foreground'}`}>
              <MessageSquare size={13} className="shrink-0 opacity-50" />
              <span className="flex-1 truncate">{sess.title}</span>
              <button onClick={e => { e.stopPropagation(); deleteSession(sess.id); }}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"><X size={12} /></button>
            </div>
          ))}
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
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

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="flex flex-col gap-6 max-w-4xl mx-auto pb-4">
            {messages.length === 0 && (
              <div className="text-center text-muted-foreground mt-32 flex flex-col items-center">
                <div className="w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-4 text-2xl">🤖</div>
                <p className="text-lg font-medium">Ask me about {techCategory === 'sap-pack' ? 'SAP Fiori' : 'Salesforce CRM'}!</p>
                <p className="text-sm mt-2 text-muted-foreground/70">
                  {techCategory === 'sap-pack' ? 'Try: "What are the steps for period-end closing in SAP FI?"' : 'Try: "How do I convert a lead in Salesforce?"'}
                </p>
              </div>
            )}
            {messages.map(m => {
              const maxScore = Math.max(...(m.sources?.map(s => s.score) ?? [0]));
              const lowConfidence = m.sources !== undefined && maxScore < 0.7;
              const noSources = m.role === 'assistant' && m.sources !== undefined && m.sources.length === 0;
              const showDraftBtn = m.role === 'assistant' && (m.helpful === false || lowConfidence || noSources);

              return (
                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`px-5 py-4 rounded-2xl max-w-[85%] shadow-sm flex flex-col gap-3 ${m.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-br-sm'
                    : 'bg-[#F1F1EF] text-[#000000] border border-[#CFCFCF] rounded-bl-sm'}`}>

                    {m.image && (
                      <div className="mb-1 p-2 bg-black/10 rounded-lg inline-block">
                        <div className="text-xs font-bold mb-2 flex items-center gap-1 uppercase tracking-wider opacity-90"><span>👁️</span> Vision Analysis</div>
                        <img src={m.image} alt="User upload" className="max-w-[240px] rounded border shadow-sm" />
                      </div>
                    )}

                    <p className="whitespace-pre-wrap leading-relaxed text-sm">
                      {typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}
                    </p>

                    {/* Action bar — assistant only */}
                    {m.role === 'assistant' && m.content && (
                      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[#CFCFCF]">

                        {/* Helpful vote */}
                        {m.helpful === null && (
                          <div className="flex items-center gap-1 mr-auto">
                            <span className="text-xs text-gray-500">Helpful?</span>
                            <button onClick={() => markHelpful(m.id, true)} className="text-base hover:scale-125 transition-transform" title="Yes">👍</button>
                            <button onClick={() => markHelpful(m.id, false)} className="text-base hover:scale-125 transition-transform" title="No">👎</button>
                          </div>
                        )}
                        {m.helpful === true && <span className="text-xs text-green-600 mr-auto">👍 Thanks for the feedback!</span>}
                        {m.helpful === false && <span className="text-xs text-orange-600 mr-auto">👎 Sorry about that!</span>}

                        {/* Show Me button */}
                        {m.focusCoord && m.sources && m.sources.some(s => s.metadata?.type !== 'jira_ticket' && s.metadata?.type !== 'pdf_document') && (
                          <button onClick={() => openSources(m.sources!, m.focusCoord, true)}
                            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full transition-colors text-white"
                            style={{ background: '#7500C0' }}>
                            <Target size={12} /> Show Me
                          </button>
                        )}

                        {/* View Source button */}
                        {m.sources && m.sources.length > 0 && (
                          <button onClick={() => openSources(m.sources!, m.focusCoord, false)}
                            className="text-xs font-semibold text-primary hover:underline flex items-center gap-1.5">
                            <BookOpen size={12} />
                            View Source ({m.sources.length} match{m.sources.length > 1 ? 'es' : ''})
                          </button>
                        )}

                        {/* Draft Ticket button */}
                        {showDraftBtn && (
                          <button onClick={() => openJiraDraft(m)}
                            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border transition-colors"
                            style={{ borderColor: '#460073', color: '#460073' }}>
                            <Ticket size={12} /> Still stuck? Draft a Ticket
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

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

        <div className="shrink-0 px-6 py-4 border-t bg-background/95 backdrop-blur">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-4xl mx-auto">
            {imagePreview && (
              <div className="relative inline-block w-20 h-20 border-2 border-primary/20 rounded-xl overflow-hidden shadow-sm self-start ml-16">
                <img src={imagePreview} alt="preview" className="object-cover w-full h-full" />
                <button type="button" onClick={() => setImagePreview(null)} className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 hover:bg-black/80"><X size={12} /></button>
              </div>
            )}
            <div className="flex gap-3 items-center">
              <div {...getRootProps()} className="cursor-pointer border-2 border-dashed border-primary/30 rounded-full hover:bg-primary/5 hover:border-primary/60 transition-colors flex items-center justify-center h-14 w-14 shrink-0 group" title="Upload Screenshot">
                <input {...getInputProps()} />
                <ImagePlus className="w-6 h-6 text-primary/70 group-hover:text-primary transition-colors" />
              </div>
              <Input value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleSubmit(e as unknown as React.FormEvent); }}
                placeholder={imagePreview ? "Add context for the visual audit..." : `Ask about ${techCategory === 'sap-pack' ? 'SAP FI' : 'Salesforce CRM'}...`}
                className="flex-1 shadow-sm h-14 rounded-full px-6 border-2 focus-visible:ring-primary text-base" />
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
      <div className={`fixed top-0 right-0 w-[440px] h-full bg-white border-l shadow-2xl flex flex-col transform transition-transform duration-300 z-50 ${isPanelOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex justify-between items-center px-6 py-5 border-b shrink-0">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <BookOpen size={18} className="text-primary" /> Source Citations
          </h2>
          <button onClick={() => setIsPanelOpen(false)} className="text-muted-foreground hover:text-foreground"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {!panelSources || panelSources.length === 0
            ? <p className="text-sm text-muted-foreground text-center mt-8">No source citations available.</p>
            : panelSources.map((src, i) => {
              const isVideoSrc = src.metadata?.type !== 'jira_ticket' && src.metadata?.type !== 'pdf_document';
              const isTopVideo = showOverlayInPanel && i === 0 && isVideoSrc;
              return (
                <SourceCard key={i} src={src}
                  focusCoord={isTopVideo ? panelFocus : null}
                  showOverlay={isTopVideo && panelFocus != null}
                />
              );
            })
          }
        </div>
      </div>
      {isPanelOpen && <div className="fixed inset-0 bg-black/20 z-40 lg:hidden" onClick={() => setIsPanelOpen(false)} />}

      {/* ── JIRA Draft Modal ── */}
      {jiraPayload && (
        <JiraDraftModal
          payload={jiraPayload}
          onClose={() => setJiraPayload(null)}
        />
      )}
    </div>
  );
}
