import logging
import asyncio
import base64
import json
from io import BytesIO
import PIL.Image
import google.generativeai as genai
import os
from database import get_vector_store
from llama_index.core import VectorStoreIndex, StorageContext, Settings

logging.basicConfig(level=logging.INFO)

# Relevance threshold — below this score, we consider it "no match"
SOURCE_SCORE_THRESHOLD = 0.3

def _serialize_sources(source_nodes: list) -> str:
    """Serialize source nodes to a JSON marker appended to the stream."""
    sources = []
    for node in source_nodes[:3]:  # top 3 sources
        score = node.score or 0
        if score < SOURCE_SCORE_THRESHOLD:
            continue
        sources.append({
            "text": node.node.get_content()[:500],
            "score": round(score, 3),
            "metadata": {k: v for k, v in (node.node.metadata or {}).items()
                         if k in ("source", "frame_index", "content_tier", "type")},
        })
    if not sources:
        return ""
    return f"\n\n__SOURCES__{json.dumps(sources)}__END_SOURCES__"


async def query_agent_stream(query: str, namespace: str):
    logging.info(f"Received query '{query}' for namespace: {namespace}")

    try:
        vector_store = get_vector_store(namespace)
        storage_context = StorageContext.from_defaults(vector_store=vector_store)
        index = VectorStoreIndex.from_vector_store(vector_store, storage_context=storage_context)
        query_engine = index.as_query_engine(streaming=True)

        response = query_engine.query(query)

        # Stream text tokens
        for text in response.response_gen:
            yield text
            await asyncio.sleep(0.01)

        # After all text, append real source nodes as a JSON marker
        sources_marker = _serialize_sources(response.source_nodes)
        if sources_marker:
            yield sources_marker

    except Exception as e:
        logging.error(f"Query Error: {e}")
        yield f"[System Error] Unable to query knowledge base. Error: {str(e)}"


async def analyze_image_stream(messages: list, namespace: str, base64_image: str):
    logging.info(f"Received image analysis request for namespace: {namespace}")

    try:
        image_data = base64.b64decode(base64_image)
        img = PIL.Image.open(BytesIO(image_data))
    except Exception as e:
        yield f"Error decoding image: {e}"
        return

    try:
        api_key = os.environ.get("GOOGLE_API_KEY", "")
        if not api_key:
            raise ValueError("GOOGLE_API_KEY is not set.")

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-2.5-flash')

        yield "👁️ **Vision Analysis Initiated**\n"
        await asyncio.sleep(0.1)

        prompt = (
            "Analyze this screenshot of a software application. Identify any error messages, "
            "context, or UI actions the user is attempting. Be concise but technically precise."
        )
        response = model.generate_content([prompt, img])
        extracted_text = response.text
        logging.info(f"Vision Extracted Context: {extracted_text}")

        yield f"**Findings:**\n{extracted_text}\n\n---\n\n🔍 **Synthesizing Solution from Knowledge Base...**\n\n"

        last_user_message = messages[-1]["content"] if messages else ""
        query_text = (
            f"User Question: {last_user_message}\n\n"
            f"Visual Context from Screenshot: {extracted_text}\n\n"
            f"Provide a solution synthesizing both the visual context and documentation."
        )

        vector_store = get_vector_store(namespace)
        storage_context = StorageContext.from_defaults(vector_store=vector_store)
        index = VectorStoreIndex.from_vector_store(vector_store, storage_context=storage_context)
        query_engine = index.as_query_engine(streaming=True)

        query_response = query_engine.query(query_text)
        for text in query_response.response_gen:
            yield text
            await asyncio.sleep(0.01)

        sources_marker = _serialize_sources(query_response.source_nodes)
        if sources_marker:
            yield sources_marker

    except Exception as e:
        logging.error(f"Vision Synthesize Error: {e}")
        yield f"[System Error] Vision analysis failed. Error: {str(e)}"
