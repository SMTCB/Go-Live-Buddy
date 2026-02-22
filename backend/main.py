from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import os
from dotenv import load_dotenv
import asyncio
from agent import query_agent_stream

load_dotenv()

app = FastAPI(title="Go-Live Buddy API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Go-Live Buddy API is running"}

@app.post("/api/chat")
async def chat_endpoint(request: Request):
    data = await request.json()
    messages = data.get("messages", [])
    
    last_message = messages[-1]["content"] if messages else ""
    
    return StreamingResponse(query_agent_stream(last_message), media_type="text/plain")
