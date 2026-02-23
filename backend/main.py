from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
import os
import sys
import json
import random
from datetime import datetime, timezone

# Crucial for Vercel: Add the current directory to Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv, find_dotenv
import asyncio
from agent import query_agent_stream
from ingest import process_ingestion

load_dotenv(find_dotenv())

_HERE = os.path.dirname(os.path.abspath(__file__))
TICKETS_FILE = os.path.join(_HERE, "simulated_tickets.json")

def _load_tickets():
    if not os.path.exists(TICKETS_FILE):
        return []
    try:
        with open(TICKETS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []

def _save_tickets(tickets):
    with open(TICKETS_FILE, "w", encoding="utf-8") as f:
        json.dump(tickets, f, indent=2, ensure_ascii=False)

app = FastAPI(title="Go-Live Buddy API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class IngestRequest(BaseModel):
    sourceUrl: str
    techCategory: str
    contentTier: str

@app.get("/")
def read_root():
    return {"message": "Go-Live Buddy API is running"}

@app.post("/api/chat")
async def chat_endpoint(request: Request):
    data = await request.json()
    messages = data.get("messages", [])
    namespace = data.get("namespace", "sap-pack")
    
    last_message = messages[-1]["content"] if messages else ""
    
    return StreamingResponse(query_agent_stream(last_message, namespace), media_type="text/plain")

@app.post("/api/analyze_image")
async def analyze_image_endpoint(request: Request):
    from agent import analyze_image_stream
    data = await request.json()
    messages = data.get("messages", [])
    namespace = data.get("namespace", "sap-pack")
    base64_image = data.get("image", "")

    if "," in base64_image:
        base64_image = base64_image.split(",")[1]

    return StreamingResponse(analyze_image_stream(messages, namespace, base64_image), media_type="text/plain")

@app.post("/api/ingest")
async def ingest_endpoint(req: IngestRequest):
    if not req.techCategory or not req.contentTier or not req.sourceUrl:
        raise HTTPException(status_code=400, detail="All fields are required")

    import queue, threading

    progress_queue: queue.Queue = queue.Queue()

    def run_ingestion():
        try:
            process_ingestion(
                req.sourceUrl,
                req.techCategory,
                req.contentTier,
                progress_cb=lambda msg: progress_queue.put(msg)
            )
        except Exception as e:
            progress_queue.put(f"❌ Unexpected error: {e}")
        finally:
            progress_queue.put(None)  # sentinel — done

    thread = threading.Thread(target=run_ingestion, daemon=True)
    thread.start()

    async def stream_progress():
        while True:
            try:
                msg = progress_queue.get(timeout=300)
                if msg is None:
                    yield "DONE\n"
                    break
                yield f"{msg}\n"
                await asyncio.sleep(0)
            except queue.Empty:
                yield "⚠️ Ingestion timed out.\n"
                break

    return StreamingResponse(stream_progress(), media_type="text/plain")


class TicketDraftRequest(BaseModel):
    subject:       str
    description:   str
    priority:      str = "Medium"
    systemContext: str = ""
    namespace:     str = ""

@app.post("/api/tickets/draft")
async def draft_ticket(req: TicketDraftRequest):
    tickets = _load_tickets()
    ticket_id = f"SAP-MOCK-{random.randint(100, 999)}"
    entry = {
        "ticket_id":     ticket_id,
        "subject":       req.subject,
        "description":   req.description,
        "priority":      req.priority,
        "systemContext": req.systemContext,
        "namespace":     req.namespace,
        "createdAt":     datetime.now(timezone.utc).isoformat(),
        "status":        "Open",
    }
    tickets.append(entry)
    _save_tickets(tickets)
    return JSONResponse({"ticket_id": ticket_id, "status": "created"})

@app.get("/api/tickets")
async def list_tickets():
    return JSONResponse(_load_tickets())

@app.get("/api/debug/focus")
async def debug_focus(namespace: str = "sap-pack", frame_index: int = 17, query: str = "How do I upload a journal entry file?"):
    """
    Debug endpoint: directly test Gemini Vision focus coord generation.
    Usage: GET /api/debug/focus?namespace=sap-pack&frame_index=17&query=How+do+I+upload+a+journal+entry
    """
    from agent import _get_focus_coord, _PUBLIC_FRAMES
    import os
    frame_path = os.path.join(_PUBLIC_FRAMES, namespace, f"{frame_index}.jpg")
    
    # We'll use a local import trick to get the error if we want, 
    # but for now let's just make sure agent.py returns it or we log it.
    coord = _get_focus_coord(namespace, frame_index, query)
    
    return JSONResponse({
        "frame_path": frame_path,
        "frame_exists": os.path.isfile(frame_path),
        "google_api_key_set": bool(os.environ.get("GOOGLE_API_KEY", "")),
        "coord": coord,
        "success": coord is not None,
        "note": "Check backend terminal for [FocusCoord] logs if success is false"
    })
