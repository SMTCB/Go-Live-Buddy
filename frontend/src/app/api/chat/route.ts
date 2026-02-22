import { StreamingTextResponse } from 'ai';

export const maxDuration = 30;

export async function POST(req: Request) {
    const { messages } = await req.json();

    const response = await fetch('http://localhost:8000/api/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages }),
    });

    if (!response.ok) {
        return new Response(await response.text(), {
            status: response.status,
        });
    }

    return new StreamingTextResponse(response.body!);
}
