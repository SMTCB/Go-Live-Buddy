'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

const formSchema = z.object({
    sourceUrl: z.string().url({ message: "Must be a valid URL (e.g. YouTube or a direct PDF link)" }),
    techCategory: z.string().min(1, { message: "Please select a technology category." }),
    contentTier: z.string().min(1, { message: "Please select a content tier." }),
});
type FormValues = z.infer<typeof formSchema>;

type SimTicket = {
    ticket_id: string;
    subject: string;
    priority: string;
    systemContext: string;
    namespace: string;
    createdAt: string;
    status: string;
};

const PRIORITY_COLORS: Record<string, string> = {
    Low: 'bg-green-100  text-green-800',
    Medium: 'bg-yellow-100 text-yellow-800',
    High: 'bg-orange-100 text-orange-800',
    Critical: 'bg-red-100    text-red-800',
};

export default function AdminDashboard() {
    const [tab, setTab] = useState<'ingest' | 'tickets'>('ingest');

    // ── Ingestion state ───────────────────────────────────────────────────────
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [progressLines, setProgressLines] = useState<string[]>([]);
    const [isDone, setIsDone] = useState(false);
    const [hasError, setHasError] = useState(false);
    const logRef = useRef<HTMLDivElement>(null);

    // ── Tickets state ─────────────────────────────────────────────────────────
    const [tickets, setTickets] = useState<SimTicket[]>([]);
    const [loadingTickets, setLoadingTickets] = useState(false);

    const { register, handleSubmit, formState: { errors }, reset } = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: { sourceUrl: '', techCategory: '', contentTier: '' },
    });

    const addLine = (line: string) => {
        setProgressLines(prev => [...prev, line]);
        setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }), 50);
    };

    const loadTickets = async () => {
        setLoadingTickets(true);
        try {
            const res = await fetch('/api/tickets');
            const data = await res.json();
            setTickets([...data].reverse()); // newest first
        } catch { /* ignore */ }
        finally { setLoadingTickets(false); }
    };

    useEffect(() => {
        if (tab === 'tickets') loadTickets();
    }, [tab]);

    const onSubmit = async (data: FormValues) => {
        setIsSubmitting(true);
        setProgressLines([]);
        setIsDone(false);
        setHasError(false);
        addLine(`🚀 Submitting ingestion request...`);
        addLine(`   Source: ${data.sourceUrl}`);
        addLine(`   Namespace: ${data.techCategory}  |  Tier: ${data.contentTier}`);
        addLine(`─────────────────────────────────────────`);
        try {
            const response = await fetch('/api/ingest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!response.ok) { addLine(`❌ Server error: ${await response.text()}`); setHasError(true); return; }
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const text = decoder.decode(value, { stream: true });
                    for (const line of text.split('\n').filter(l => l.trim())) {
                        if (line === 'DONE') { setIsDone(true); addLine(`─────────────────────────────────────────`); addLine(`✅ Ingestion complete!`); }
                        else if (line.startsWith('❌')) { setHasError(true); addLine(line); }
                        else { addLine(line); }
                    }
                }
            }
            if (!isDone) setIsDone(true);
            reset();
        } catch (err: unknown) {
            addLine(`❌ Fetch error: ${err instanceof Error ? err.message : String(err)}`);
            setHasError(true);
        } finally { setIsSubmitting(false); }
    };

    return (
        <div className="flex min-h-screen w-full bg-background font-sans items-start justify-center p-8 pt-12">
            <div className="w-full max-w-3xl flex flex-col gap-6">
                <div>
                    <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: '#460073' }}>
                        Go-Live Buddy Admin
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        Manage knowledge ingestion and review simulated support tickets.
                    </p>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 bg-muted p-1 rounded-xl w-fit">
                    {(['ingest', 'tickets'] as const).map(t => (
                        <button key={t} onClick={() => setTab(t)}
                            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${tab === t
                                    ? 'bg-white shadow text-foreground'
                                    : 'text-muted-foreground hover:text-foreground'
                                }`}>
                            {t === 'ingest' ? '🚀 Ingest Content' : '🎫 Simulated Tickets'}
                        </button>
                    ))}
                </div>

                {/* ── Ingestion Tab ── */}
                {tab === 'ingest' && (
                    <>
                        <Card className="shadow-md border-border bg-card">
                            <CardHeader>
                                <CardTitle className="text-lg font-bold text-foreground">New Ingestion Job</CardTitle>
                                <CardDescription>PDF ingestion may take 1–5 minutes. Video ingestion can take 10–30 minutes. Keep this tab open.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                                    <div className="space-y-2">
                                        <label className="text-sm font-semibold text-foreground">Technology Category <span className="text-destructive">*</span></label>
                                        <select {...register('techCategory')} className="w-full border-2 border-input rounded-md px-3 py-2 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                                            <option value="">Select Category...</option>
                                            <option value="sap-pack">SAP FI</option>
                                            <option value="crm-pack">Salesforce CRM</option>
                                        </select>
                                        {errors.techCategory && <p className="text-xs text-destructive font-bold">{errors.techCategory.message}</p>}
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-semibold text-foreground">Content Tier <span className="text-destructive">*</span></label>
                                        <div className="flex gap-6">
                                            <label className="flex items-center gap-2 text-sm"><input type="radio" value="Standard" {...register('contentTier')} className="accent-primary" /> Standard</label>
                                            <label className="flex items-center gap-2 text-sm"><input type="radio" value="Project-Specific" {...register('contentTier')} className="accent-primary" /> Project-Specific</label>
                                        </div>
                                        {errors.contentTier && <p className="text-xs text-destructive font-bold">{errors.contentTier.message}</p>}
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-semibold text-foreground">Source URL <span className="text-destructive">*</span></label>
                                        <Input {...register('sourceUrl')} placeholder="https://youtube.com/... or https://example.com/doc.pdf" className="border-2 focus-visible:ring-primary" />
                                        <p className="text-xs text-muted-foreground">Provide a public YouTube URL or a direct link to a PDF document.</p>
                                        {errors.sourceUrl && <p className="text-xs text-destructive font-bold">{errors.sourceUrl.message}</p>}
                                    </div>
                                    <Button type="submit" className="w-full" disabled={isSubmitting}>
                                        {isSubmitting ? '⏳ Processing... (keep this tab open)' : '🚀 Start Ingestion'}
                                    </Button>
                                </form>
                            </CardContent>
                        </Card>

                        {progressLines.length > 0 && (
                            <Card className={`shadow-md border-2 ${hasError ? 'border-destructive/40' : isDone ? 'border-green-400/40' : 'border-primary/20'}`}>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                                        {isDone ? <span className="text-green-600">✅ Completed</span>
                                            : hasError ? <span className="text-destructive">❌ Failed</span>
                                                : <span className="text-primary animate-pulse">⏳ Running...</span>}
                                        <span className="font-normal text-muted-foreground">Ingestion Log</span>
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div ref={logRef} className="bg-[#1A1A2E] text-green-300 font-mono text-xs p-4 rounded-lg h-64 overflow-y-auto flex flex-col gap-0.5">
                                        {progressLines.map((line, i) => (
                                            <span key={i} className={line.startsWith('❌') ? 'text-red-400' : line.startsWith('✅') ? 'text-green-400' : line.startsWith('─') ? 'text-gray-600' : 'text-green-300'}>{line}</span>
                                        ))}
                                        {isSubmitting && <span className="text-yellow-400 animate-pulse">▌</span>}
                                    </div>
                                </CardContent>
                            </Card>
                        )}
                    </>
                )}

                {/* ── Simulated Tickets Tab ── */}
                {tab === 'tickets' && (
                    <Card className="shadow-md border-border">
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle className="text-lg font-bold" style={{ color: '#460073' }}>Simulated Tickets</CardTitle>
                                <CardDescription>Tickets drafted by users via the JIRA Autopilot feature.</CardDescription>
                            </div>
                            <button onClick={loadTickets}
                                className="text-xs font-semibold px-4 py-1.5 rounded-full border border-[#460073]/30 text-[#460073] hover:bg-[#460073]/5 transition-colors">
                                🔄 Refresh
                            </button>
                        </CardHeader>
                        <CardContent>
                            {loadingTickets ? (
                                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm animate-pulse">
                                    Loading tickets...
                                </div>
                            ) : tickets.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm gap-2">
                                    <span className="text-3xl">🎫</span>
                                    No simulated tickets yet. Try asking a hard question in the chat!
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wider">
                                                <th className="text-left py-2 px-3 font-semibold">ID</th>
                                                <th className="text-left py-2 px-3 font-semibold">Subject</th>
                                                <th className="text-left py-2 px-3 font-semibold">Priority</th>
                                                <th className="text-left py-2 px-3 font-semibold">System</th>
                                                <th className="text-left py-2 px-3 font-semibold">Created</th>
                                                <th className="text-left py-2 px-3 font-semibold">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {tickets.map(t => (
                                                <tr key={t.ticket_id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                                                    <td className="py-2.5 px-3 font-mono font-bold text-xs" style={{ color: '#460073' }}>{t.ticket_id}</td>
                                                    <td className="py-2.5 px-3 max-w-[240px] truncate">{t.subject}</td>
                                                    <td className="py-2.5 px-3">
                                                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${PRIORITY_COLORS[t.priority] ?? 'bg-gray-100 text-gray-700'}`}>
                                                            {t.priority}
                                                        </span>
                                                    </td>
                                                    <td className="py-2.5 px-3 text-xs text-muted-foreground">{t.systemContext || t.namespace}</td>
                                                    <td className="py-2.5 px-3 text-xs text-muted-foreground whitespace-nowrap">
                                                        {new Date(t.createdAt).toLocaleDateString()} {new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </td>
                                                    <td className="py-2.5 px-3">
                                                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800">{t.status}</span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}
