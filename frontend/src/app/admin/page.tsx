'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';

const formSchema = z.object({
    sourceUrl: z.string().url({ message: "Must be a valid URL (e.g. YouTube or PDF link)" }).optional().or(z.literal('')),
    techCategory: z.string().min(1, { message: "Please select a technology category." }),
    contentTier: z.string().min(1, { message: "Please select a content tier." }),
}).refine(data => data.sourceUrl !== '', {
    message: "Source URL is required for now (File uploads coming soon).",
    path: ['sourceUrl'],
});

type FormValues = z.infer<typeof formSchema>;

export default function AdminDashboard() {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitStatus, setSubmitStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

    const {
        register,
        handleSubmit,
        formState: { errors },
        reset
    } = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            sourceUrl: '',
        },
    });

    const onSubmit = async (data: FormValues) => {
        setIsSubmitting(true);
        setSubmitStatus(null);
        try {
            const response = await fetch('http://localhost:8000/api/ingest', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sourceUrl: data.sourceUrl,
                    techCategory: data.techCategory,
                    contentTier: data.contentTier,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Ingestion failed');
            }

            setSubmitStatus({ type: 'success', message: 'Content successfully ingested and vectorized!' });
            reset();
        } catch (error: any) {
            setSubmitStatus({ type: 'error', message: error.message || 'An unexpected error occurred.' });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="flex h-screen w-full bg-background relative overflow-hidden font-sans items-center justify-center p-6">
            <Card className="w-full max-w-lg shadow-xl border-border bg-card">
                <CardHeader className="space-y-1">
                    <CardTitle className="text-2xl font-bold tracking-tight text-primary">Ingestion Dashboard</CardTitle>
                    <CardDescription className="text-muted-foreground">
                        Strictly validate and ingest new knowledge into the Pinecone Vector DB.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">

                        {/* Tech Category */}
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-foreground">Technology Category <span className="text-destructive">*</span></label>
                            <select
                                {...register('techCategory')}
                                className="w-full border-2 border-input rounded-md px-3 py-2 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                                <option value="">Select Category...</option>
                                <option value="sap-pack">SAP FI</option>
                                <option value="crm-pack">Salesforce CRM</option>
                                <option value="add-new">Add New (Admin)</option>
                            </select>
                            {errors.techCategory && <p className="text-xs text-destructive font-bold">{errors.techCategory.message}</p>}
                        </div>

                        {/* Content Tier */}
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-foreground">Content Tier <span className="text-destructive">*</span></label>
                            <div className="flex gap-4">
                                <label className="flex items-center gap-2 text-sm text-foreground">
                                    <input type="radio" value="Standard" {...register('contentTier')} className="accent-primary" />
                                    Standard
                                </label>
                                <label className="flex items-center gap-2 text-sm text-foreground">
                                    <input type="radio" value="Project-Specific" {...register('contentTier')} className="accent-primary" />
                                    Project-Specific
                                </label>
                            </div>
                            {errors.contentTier && <p className="text-xs text-destructive font-bold">{errors.contentTier.message}</p>}
                        </div>

                        {/* Source URL */}
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-foreground">Source Material (URL) <span className="text-destructive">*</span></label>
                            <Input
                                {...register('sourceUrl')}
                                placeholder="https://youtube.com/... or https://...pdf"
                                className="border-2 focus-visible:ring-primary bg-background"
                            />
                            <p className="text-xs text-muted-foreground">Direct file uploads will be added in a future update. For now, provide a public URL.</p>
                            {errors.sourceUrl && <p className="text-xs text-destructive font-bold">{errors.sourceUrl.message}</p>}
                        </div>

                        {/* Status Message */}
                        {submitStatus && (
                            <div className={`p-3 rounded-md text-sm font-semibold ${submitStatus.type === 'success' ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-destructive/10 text-destructive border border-destructive/20'}`}>
                                {submitStatus.message}
                            </div>
                        )}

                        <Button type="submit" className="w-full" disabled={isSubmitting}>
                            {isSubmitting ? 'Processing & Ingesting...' : 'Validate & Ingest Content'}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
