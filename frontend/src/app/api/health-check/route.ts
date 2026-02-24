import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    const backendUrl = (() => {
        const raw =
            process.env.API_URL ||
            process.env.NEXT_PUBLIC_API_URL ||
            'http://127.0.0.1:8000';
        return raw.startsWith('http') ? raw : `https://${raw}`;
    })();

    let railwayStatus = 'unreachable';
    let railwayMessage = '';

    try {
        const res = await fetch(`${backendUrl}/`, { signal: AbortSignal.timeout(5000) });
        const data = await res.json().catch(() => ({}));
        railwayStatus = res.ok ? 'ok' : `error_${res.status}`;
        railwayMessage = data?.message ?? '';
    } catch (e) {
        railwayStatus = 'fetch_failed';
        railwayMessage = String(e);
    }

    return NextResponse.json({
        proxy_target: backendUrl,
        api_url_env: process.env.API_URL ?? '(not set)',
        next_public_api_url_env: process.env.NEXT_PUBLIC_API_URL ?? '(not set)',
        railway_status: railwayStatus,
        railway_message: railwayMessage,
    });
}
