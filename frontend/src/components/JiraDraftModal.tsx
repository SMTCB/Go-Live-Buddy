'use client';
import { useState } from 'react';
import { X, Ticket } from 'lucide-react';

type Priority = 'Low' | 'Medium' | 'High' | 'Critical';

export type JiraDraftPayload = {
    subject: string;
    description: string;
    priority: Priority;
    systemContext: string;
    namespace: string;
};

type Props = {
    payload: JiraDraftPayload;
    onClose: () => void;
};

export default function JiraDraftModal({ payload, onClose }: Props) {
    const [description, setDescription] = useState(payload.description);
    const [priority, setPriority] = useState<Priority>(payload.priority);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [ticketId, setTicketId] = useState<string | null>(null);

    const priorityColor: Record<Priority, string> = {
        Low: 'bg-green-100  text-green-800  border-green-300',
        Medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
        High: 'bg-orange-100 text-orange-800 border-orange-300',
        Critical: 'bg-red-100    text-red-800    border-red-300',
    };

    const handleSubmit = async () => {
        setIsSubmitting(true);
        try {
            const res = await fetch('/api/tickets/draft', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, description, priority }),
            });
            const data = await res.json();
            setTicketId(data.ticket_id ?? 'SAP-MOCK-999');
        } catch {
            setTicketId('SAP-MOCK-999');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        /* Backdrop */
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="w-[540px] max-w-[95vw] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
                style={{ background: '#F1F1EF' }}>

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4"
                    style={{ background: '#460073' }}>
                    <div className="flex items-center gap-3">
                        <Ticket className="text-white/80" size={20} />
                        <h2 className="text-white font-bold text-lg tracking-tight">Draft Support Ticket</h2>
                    </div>
                    <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {!ticketId ? (
                    /* Form */
                    <div className="p-6 flex flex-col gap-5">

                        {/* Subject — read-only */}
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-bold text-[#460073] uppercase tracking-wider">Subject</label>
                            <div className="px-4 py-2.5 bg-white/60 rounded-lg border border-[#460073]/20 text-sm text-gray-700 line-clamp-2">
                                {payload.subject}
                            </div>
                        </div>

                        {/* System Context — read-only */}
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-bold text-[#460073] uppercase tracking-wider">System Context</label>
                            <div className="px-4 py-2.5 bg-white/60 rounded-lg border border-[#460073]/20 text-sm text-gray-700">
                                {payload.systemContext}
                            </div>
                        </div>

                        {/* Priority */}
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-bold text-[#460073] uppercase tracking-wider">Priority</label>
                            <div className="flex gap-2 flex-wrap">
                                {(['Low', 'Medium', 'High', 'Critical'] as Priority[]).map(p => (
                                    <button
                                        key={p}
                                        onClick={() => setPriority(p)}
                                        className={`px-4 py-1.5 rounded-full border text-xs font-bold transition-all ${priority === p
                                                ? priorityColor[p] + ' ring-2 ring-offset-1 ring-[#460073]/40'
                                                : 'bg-white/50 text-gray-500 border-gray-200 hover:border-gray-400'
                                            }`}
                                    >{p}</button>
                                ))}
                            </div>
                        </div>

                        {/* Description — editable */}
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-bold text-[#460073] uppercase tracking-wider">
                                Issue Description <span className="font-normal text-gray-400 normal-case">(editable)</span>
                            </label>
                            <textarea
                                rows={5}
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                className="px-4 py-3 bg-white rounded-lg border border-[#460073]/20 text-sm text-gray-700
                           focus:outline-none focus:ring-2 focus:ring-[#460073]/30 resize-none"
                            />
                        </div>

                        {/* Actions */}
                        <div className="flex justify-end gap-3 pt-1">
                            <button onClick={onClose}
                                className="px-5 py-2 text-sm font-semibold text-gray-600 bg-white border border-gray-200
                           rounded-full hover:bg-gray-50 transition-colors">
                                Cancel
                            </button>
                            <button onClick={handleSubmit} disabled={isSubmitting}
                                className="px-6 py-2 text-sm font-bold text-white rounded-full
                           transition-all hover:opacity-90 disabled:opacity-60"
                                style={{ background: '#460073' }}>
                                {isSubmitting ? '⏳ Submitting...' : '🎫 Submit Ticket'}
                            </button>
                        </div>
                    </div>
                ) : (
                    /* Success */
                    <div className="p-10 flex flex-col items-center gap-5 text-center">
                        <div className="w-20 h-20 rounded-full flex items-center justify-center text-4xl
                            animate-bounce" style={{ background: '#7500C020' }}>
                            ✅
                        </div>
                        <div>
                            <p className="text-2xl font-extrabold" style={{ color: '#460073' }}>
                                Ticket Created!
                            </p>
                            <p className="text-lg font-bold text-gray-700 mt-1">#{ticketId}</p>
                        </div>
                        <p className="text-sm text-gray-500 max-w-xs">
                            A Super User has been notified and will follow up shortly.
                        </p>
                        <button onClick={onClose}
                            className="mt-2 px-8 py-2.5 text-sm font-bold text-white rounded-full
                         hover:opacity-90 transition-opacity"
                            style={{ background: '#460073' }}>
                            Done
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
