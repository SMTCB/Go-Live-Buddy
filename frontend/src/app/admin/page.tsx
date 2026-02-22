'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

const formSchema = z.object({
    sourceUrl: z.string().url({ message: "Must be a valid URL (e.g. YouTube or a direct PDF link)" }),
    techCategory: z.string().min(1, { message: "Please select a technology category." }),
    contentTier: z.string().min(1, { message: "Please select a content tier." }),
});

type FormValues = z.infer<typeof formSchema>;

export default function AdminDashboard() {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [progressLines, setProgressLines] = useState<string[]>([]);
    const [isDone, setIsDone] = useState(false);
    const [hasError, setHasError] = useState(false);
    const logRef = useRef<HTMLDivElement>(null);

    const { register, handleSubmit, formState: { errors }, reset } = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: { sourceUrl: '', techCategory: '', contentTier: '' },
    });

    const addLine = (line: string) => {
        setProgressLines(prev => [...prev, line]);
        setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }), 50);
    };

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

            if (!response.ok) {
                const err = await response.text();
                addLine(`❌ Server error: ${err}`);
                setHasError(true);
                return;
            }

            // Stream progress lines
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const text = decoder.decode(value, { stream: true });
                    const lines = text.split('\n').filter(l => l.trim());
                    for (const line of lines) {
                        if (line === 'DONE') {
                            setIsDone(true);
                            addLine(`─────────────────────────────────────────`);
                            addLine(`✅ Ingestion complete!`);
                        } else if (line.startsWith('❌')) {
                            setHasError(true);
                            addLine(line);
                        } else {
                            addLine(line);
                        }
                    }
                }
            }
            if (!isDone) {
                setIsDone(true);
            }
            reset();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            addLine(`❌ Fetch error: ${msg}`);
            setHasError(true);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="flex min-h-screen w-full bg-background font-sans items-start justify-center p-8 pt-16">
            <div className="w-full max-w-2xl flex flex-col gap-6">
                <div>
                    <h1 className="text-3xl font-extrabold text-primary tracking-tight">Ingestion Dashboard</h1>
                    <p className="text-muted-foreground text-sm mt-1">Vectorize new knowledge into the Pinecone Vector DB. <span className="font-semibold">YouTube videos</span> and <span className="font-semibold">public PDF documents</span> are supported.</p>
                </div>

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

                {/* Live Progress Log */}
                {progressLines.length > 0 && (
                    <Card className={`shadow-md border-2 ${hasError ? 'border-destructive/40' : isDone ? 'border-green-400/40' : 'border-primary/20'}`}>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                                {isDone
                                    ? <span className="text-green-600">✅ Completed</span>
                                    : hasError
                                        ? <span className="text-destructive">❌ Failed</span>
                                        : <span className="text-primary animate-pulse">⏳ Running...</span>
                                }
                                <span className="font-normal text-muted-foreground">Ingestion Log</span>
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div
                                ref={logRef}
                                className="bg-[#1A1A2E] text-green-300 font-mono text-xs p-4 rounded-lg h-64 overflow-y-auto flex flex-col gap-0.5"
                            >
                                {progressLines.map((line, i) => (
                                    <span key={i} className={line.startsWith('❌') ? 'text-red-400' : line.startsWith('✅') ? 'text-green-400' : line.startsWith('─') ? 'text-gray-600' : 'text-green-300'}>
                                        {line}
                                    </span>
                                ))}
                                {isSubmitting && <span className="text-yellow-400 animate-pulse">▌</span>}
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}
