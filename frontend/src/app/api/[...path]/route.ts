import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getBackendUrl(): string {
    // Read env vars at request time (not build time)
    const raw =
        process.env.API_URL ||
        process.env.NEXT_PUBLIC_API_URL ||
        'http://127.0.0.1:8000';
    return raw.startsWith('http') ? raw : `https://${raw}`;
}

async function proxyToRailway(req: NextRequest, pathSegments: string[]) {
    const backendUrl = getBackendUrl();
    const apiPath = pathSegments.join('/');
    const search = req.nextUrl.search ?? '';
    const targetUrl = `${backendUrl}/api/${apiPath}${search}`;

    console.log(`[proxy] ${req.method} /api/${apiPath} → ${targetUrl}`);

    const headers: Record<string, string> = {
        'Content-Type': req.headers.get('Content-Type') ?? 'application/json',
    };

    let body: ArrayBuffer | undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        body = await req.arrayBuffer();
    }

    const upstream = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: body ?? undefined,
        // @ts-expect-error – Node 18 fetch supports duplex for streaming
        duplex: 'half',
    });

    // Stream the response straight back to the client
    return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: {
            'Content-Type':
                upstream.headers.get('Content-Type') ?? 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
        },
    });
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path } = await params;
    return proxyToRailway(req, path);
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path } = await params;
    return proxyToRailway(req, path);
}
