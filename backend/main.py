from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import os
from dotenv import load_dotenv, find_dotenv
import asyncio
from agent import query_agent_stream
from ingest import process_ingestion

load_dotenv(find_dotenv())

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
    if not req.techCategory or not req.contentTier:
        raise HTTPException(status_code=400, detail="Missing mandatory metadata")
    
    success = process_ingestion(req.sourceUrl, req.techCategory, req.contentTier)
    if not success:
        raise HTTPException(status_code=500, detail="Ingestion failed")
        
    return {"status": "success", "message": "Content successfully ingested"}
