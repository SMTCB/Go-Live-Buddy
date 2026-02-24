from fastapi import APIRouter, HTTPException, BackgroundTasks
import google.generativeai as genai
from database import supabase_client
import json

def analyze_and_store_query(query_text: str, tech_id: str):
    if not supabase_client:
        return

    api_key = os.environ.get("GOOGLE_API_KEY", "")
    if not api_key:
        return

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-1.5-flash") # use faster model for ingestion
        
        prompt = (
            f"Analyze this user query: '{query_text}'\n\n"
            "Return a strictly formatted JSON object:\n"
            "{\n"
            '  "detected_process": "Short name of the business process (e.g. Invoice Reversal, Journal Upload, Password Reset, Unknown)",\n'
            '  "user_sentiment": "Positive, Neutral, or Frustrated"\n'
            "}"
        )
        response = model.generate_content(prompt)
        raw = response.text.strip()
        import re
        raw = re.sub(r"^```json\n?", "", raw).strip().rstrip("`").strip()
        analysis = json.loads(raw)
        
        payload = {
            "tech_id": tech_id,
            "query_text": query_text,
            "detected_process": analysis.get("detected_process", "Unknown"),
            "user_sentiment": analysis.get("user_sentiment", "Neutral")
        }
        
        # Async insert using Supabase python client isn't fully async yet in some versions, 
        # but since this runs in a FastAPI background task which runs in a threadpool, 
        # it won't block the async event loop.
        supabase_client.table("user_queries").insert(payload).execute()
        
    except Exception as e:
        import logging
        logging.error(f"Failed to analyze and store query: {e}")

router = APIRouter()

@router.post("/api/generate-pulse")
async def generate_pulse(request_data: dict):
    tech_id = request_data.get("namespace", "sap-pack")
    
    if not supabase_client:
        raise HTTPException(status_code=500, detail="Supabase not configured in backend.")
        
    # Fetch recent rows to analyze
    try:
        # Fetch last 100 queries for the tech_id
        res = supabase_client.table("user_queries").select("*").eq("tech_id", tech_id).order("created_at", desc=True).limit(200).execute()
        queries = res.data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database fetch failed: {e}")

    if not queries:
        raise HTTPException(status_code=400, detail="Not enough data to generate pulse.")

    # Aggregate by process to find trending issues
    process_counts = {}
    sentiment_counts = {}
    for q in queries:
        process = q.get("detected_process", "Unknown")
        sentiment = q.get("user_sentiment", "Neutral")
        
        process_counts[process] = process_counts.get(process, 0) + 1
        sentiment_counts[sentiment] = sentiment_counts.get(sentiment, 0) + 1

    # Formatting context for Gemini
    data_context = (
        f"Total Queries: {len(queries)}\n"
        f"Process Breakdown:\n" + "\n".join([f"- {k}: {v}" for k,v in process_counts.items()]) + "\n"
        f"Sentiment Breakdown:\n" + "\n".join([f"- {k}: {v}" for k,v in sentiment_counts.items()]) + "\n"
        f"Sample Queries:\n" + "\n".join([f"- {q.get('query_text')}" for q in queries[:10]])
    )

    api_key = os.environ.get("GOOGLE_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="GOOGLE_API_KEY not configured.")

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-1.5-pro")
        
        prompt = (
            "Act as a Change Management Expert consulting a project sponsor. Decompose the following user chat data into actionable intel.\n\n"
            f"DATA:\n{data_context}\n\n"
            "Return a strictly formatted JSON object matching exactly this schema:\n"
            "{\n"
            '  "summary_text": "A brief overview (2-3 sentences) of the overall user comfort and project health.",\n'
            '  "key_takeaways": ["Actionable takeaway 1", "Actionable takeaway 2", "Actionable takeaway 3"],\n'
            '  "trending_processes": [{"name": "Process Name", "friction_level": "High/Medium/Low", "volume": 15}]\n'
            "}"
        )
        response = model.generate_content(prompt)
        raw = response.text.strip()
        import re
        raw = re.sub(r"^```json\n?", "", raw).strip().rstrip("`").strip()
        analysis = json.loads(raw)
        
        # Save snapshot
        snapshot_payload = {
            "tech_id": tech_id,
            "summary_text": analysis["summary_text"],
            "key_takeaways": analysis["key_takeaways"],
            "trending_processes": analysis["trending_processes"]
        }
        
        supabase_client.table("analytics_snapshots").insert(snapshot_payload).execute()
        
        return {"status": "success", "data": snapshot_payload}
        
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Gemini returned invalid JSON. {raw}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM Generation failed: {e}")

@router.get("/api/debug/supabase")
async def debug_supabase():
    try:
        from database import supabase_client
        if not supabase_client:
            return {"error": "supabase_client is None. Check SUPABASE_URL and SUPABASE_KEY env vars."}
        
        # Try a direct insert
        payload = {
            "tech_id": "debug-test",
            "query_text": "Debug insert test",
            "detected_process": "Debugging",
            "user_sentiment": "Neutral"
        }
        res = supabase_client.table("user_queries").insert(payload).execute()
        return {"status": "success", "data": res.data}
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}
