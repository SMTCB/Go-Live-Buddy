"use client";

import { useEffect, useState } from 'react';
import { BarChart as BarChartIcon, RefreshCw, AlertTriangle, Zap, CheckCircle, ThumbsUp, ThumbsDown, MinusCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { supabase } from '@/lib/supabase';

type Snapshot = {
    id: string;
    created_at: string;
    tech_id: string;
    summary_text: string;
    key_takeaways: string[];
    trending_processes: { name: string; friction_level: string; volume: number }[];
};

export default function AnalyticsDashboard() {
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [techId, setTechId] = useState('sap-pack');

    const fetchLatestSnapshot = async () => {
        setLoading(true);
        const { data } = await supabase
            .from('analytics_snapshots')
            .select('*')
            .eq('tech_id', techId)
            .order('created_at', { ascending: false })
            .limit(1);

        if (data && data.length > 0) {
            setSnapshot(data[0]);
        } else {
            setSnapshot(null);
        }
        setLoading(false);
    };

    const generateNewPulse = async () => {
        setRefreshing(true);
        try {
            // Proxied to backend via API routes, but we can hit railway directly if needed.
            // Assuming frontend Next.js rewrite is taking care of /api/*
            const res = await fetch('/api/generate-pulse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ namespace: techId })
            });
            if (res.ok) {
                await fetchLatestSnapshot();
            } else {
                alert("Failed to generate analytics pulse. Make sure your Python backend is deployed and connected to Supabase.");
            }
        } catch (e) {
            console.error(e);
            alert("Network error generating pulse.");
        }
        setRefreshing(false);
    };

    useEffect(() => {
        fetchLatestSnapshot();
    }, [techId]);

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            return (
                <div className="bg-white p-3 border shadow-lg rounded-xl">
                    <p className="font-bold text-primary mb-1">{label}</p>
                    <p className="text-sm">Issues Reported: <span className="font-semibold text-primary">{data.volume}</span></p>
                    <p className="text-sm">Friction Level: <span className="font-semibold" style={{ color: getFrictionColor(data.friction_level) }}>{data.friction_level}</span></p>
                </div>
            );
        }
        return null;
    };

    const getFrictionColor = (level: string) => {
        if (level.toLowerCase().includes('high')) return '#e11d48'; // red
        if (level.toLowerCase().includes('medium')) return '#f59e0b'; // amber
        return '#10b981'; // green
    };

    return (
        <div className="min-h-screen bg-[#F1F1EF] text-foreground font-sans p-6 md:p-12">
            <div className="max-w-6xl mx-auto space-y-8">

                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="bg-[#460073] p-2.5 rounded-xl text-white shadow-md">
                            <BarChartIcon size={24} />
                        </div>
                        <div>
                            <h1 className="text-3xl font-extrabold text-[#460073] tracking-tight">Project Pulse</h1>
                            <p className="text-muted-foreground text-sm font-medium">Real-time change management & user sentiment analytics</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 bg-white p-1.5 rounded-full border shadow-sm">
                        <select
                            value={techId}
                            onChange={e => setTechId(e.target.value)}
                            className="bg-transparent border-none text-sm font-bold text-primary focus:outline-none cursor-pointer pl-3 pr-2 py-1"
                        >
                            <option value="sap-pack">SAP FI Overview</option>
                            <option value="crm-pack">Salesforce CRM</option>
                        </select>
                        <button
                            onClick={generateNewPulse}
                            disabled={refreshing}
                            className="flex items-center gap-2 bg-[#460073] hover:bg-[#340056] text-white px-4 py-1.5 rounded-full text-sm font-semibold transition-colors disabled:opacity-50"
                        >
                            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                            {refreshing ? 'Analyzing...' : 'Manual Refresh'}
                        </button>
                    </div>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="animate-spin text-[#460073]"><RefreshCw size={32} /></div>
                    </div>
                ) : !snapshot ? (
                    <div className="bg-white border-dashed border-2 p-12 rounded-2xl text-center shadow-sm">
                        <BarChartIcon size={48} className="mx-auto text-muted-foreground/30 mb-4" />
                        <h3 className="text-lg font-bold text-[#460073] mb-2">No Pulse Data Yet</h3>
                        <p className="text-muted-foreground mb-6 max-w-md mx-auto">There are no analytics snapshots for {techId}. Click Manual Refresh to generate the first analysis from live chat data.</p>
                        <button
                            onClick={generateNewPulse}
                            className="bg-[#460073] hover:bg-[#340056] text-white px-6 py-2.5 rounded-full font-bold shadow-md transition-colors"
                        >
                            Generate Initial Pulse
                        </button>
                    </div>
                ) : (
                    <div className="space-y-6">

                        {/* Section A: Executive Summary */}
                        <div className="bg-white rounded-2xl p-6 md:p-8 shadow-sm border text-center">
                            <h2 className="text-sm font-bold tracking-widest text-[#460073]/60 uppercase mb-4">Executive Summary</h2>
                            <p className="text-xl md:text-2xl font-serif text-[#000000] leading-relaxed max-w-4xl mx-auto">
                                "{snapshot.summary_text}"
                            </p>
                            <p className="text-xs text-muted-foreground mt-6 font-medium">
                                Last updated: {new Date(snapshot.created_at).toLocaleString()}
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                            {/* Section B: Process Heatmap */}
                            <div className="bg-white rounded-2xl p-6 shadow-sm border flex flex-col h-96">
                                <h2 className="text-lg font-bold text-[#460073] mb-6 flex items-center gap-2">
                                    <Zap size={18} className="text-amber-500" />
                                    Process Heatmap (Friction & Volume)
                                </h2>
                                <div className="flex-1 w-full relative -ml-4">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={snapshot.trending_processes} margin={{ top: 0, right: 0, left: 0, bottom: 20 }}>
                                            <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b', fontWeight: 600 }} axisLine={false} tickLine={false} dy={10} />
                                            <YAxis tick={{ fontSize: 12, fill: '#64748b', fontWeight: 600 }} axisLine={false} tickLine={false} dx={-10} />
                                            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#F7F5FF' }} />
                                            <Bar dataKey="volume" radius={[6, 6, 0, 0]} maxBarSize={60}>
                                                {snapshot.trending_processes.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={getFrictionColor(entry.friction_level)} className="opacity-90 hover:opacity-100 transition-opacity" />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* Section C: Buddy's Key Takeaways */}
                            <div className="bg-white rounded-2xl p-6 shadow-md border-t-4 border-[#460073] flex flex-col h-96 overflow-y-auto relative">
                                <div className="sticky top-0 bg-white pb-4 z-10 border-b mb-4">
                                    <h2 className="text-lg font-bold text-[#460073] flex items-center gap-2">
                                        <CheckCircle size={18} className="text-emerald-500" />
                                        Buddy's Actionable Takeaways
                                    </h2>
                                </div>
                                <div className="flex-1">
                                    <ul className="space-y-4">
                                        {snapshot.key_takeaways.map((takeaway, idx) => (
                                            <li key={idx} className="flex gap-4 items-start group">
                                                <div className="bg-[#F7F5FF] text-[#460073] rounded-full w-8 h-8 flex items-center justify-center font-bold shrink-0 shadow-sm border border-primary/10 group-hover:scale-110 transition-transform">
                                                    {idx + 1}
                                                </div>
                                                <p className="text-[#000000] text-sm md:text-base leading-relaxed pt-1.5 font-medium">
                                                    {takeaway}
                                                </p>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        </div>

                    </div>
                )}

            </div>
        </div>
    );
}
