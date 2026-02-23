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
    """
    Return the best source per content type (video frame, pdf_document, jira_ticket)
    then fill remaining slots up to MAX_SOURCES from the overall top scorers.
    This guarantees cross-type diversity when multiple source types match.
    """
    MAX_SOURCES = 5

    # Filter by threshold first
    candidates = [n for n in source_nodes if (n.score or 0) >= SOURCE_SCORE_THRESHOLD]
    if not candidates:
        return ""

    def node_type(n):
        return (n.node.metadata or {}).get("type", "video")

    def to_dict(n):
        try:
            return {
                "text": (n.node.get_content() or '')[:500],
                "score": round(float(n.score or 0), 3),
                "metadata": {k: v for k, v in (n.node.metadata or {}).items()
                             if k in ("source", "frame_index", "content_tier", "type",
                                      "page_label", "ticket_id", "frame_image_url")},
            }
        except Exception as ex:
            logging.warning(f"Source node serialization failed: {ex}")
            return None

    # ── Step 1: best node per source type ────────────────────────────────────
    type_priority = ["video", "pdf_document", "jira_ticket"]
    best_by_type: dict = {}
    for n in candidates:  # candidates are already sorted by score desc from Pinecone
        t = node_type(n)
        if t not in best_by_type:
            best_by_type[t] = n
        if len(best_by_type) == len(type_priority):
            break

    selected_ids = {id(n) for n in best_by_type.values()}
    diverse = list(best_by_type.values())  # ordered by type_priority insertion

    # ── Step 2: fill remaining slots with top-scored leftovers ─────────────
    for n in candidates:
        if len(diverse) >= MAX_SOURCES:
            break
        if id(n) not in selected_ids:
            diverse.append(n)
            selected_ids.add(id(n))

    result = [to_dict(n) for n in diverse]
    result = [r for r in result if r is not None]
    if not result:
        return ""
    return f"\n\n__SOURCES__{json.dumps(result)}__END_SOURCES__"


async def query_agent_stream(query: str, namespace: str):
    logging.info(f"Received query '{query}' for namespace: {namespace}")

    try:
        vector_store = get_vector_store(namespace)
        storage_context = StorageContext.from_defaults(vector_store=vector_store)
        index = VectorStoreIndex.from_vector_store(vector_store, storage_context=storage_context)
        query_engine = index.as_query_engine(streaming=True, similarity_top_k=15)

        response = query_engine.query(query)

        # Capture source nodes BEFORE consuming the streaming generator.
        # Some LlamaIndex versions modify/clear source_nodes after stream exhaustion.
        try:
            captured_sources = list(response.source_nodes or [])
        except Exception:
            captured_sources = []

        # Stream text tokens
        for text in response.response_gen:
            yield text
            await asyncio.sleep(0.01)

        # Append source citations marker
        try:
            sources_marker = _serialize_sources(captured_sources)
            if sources_marker:
                yield sources_marker
        except Exception as e:
            logging.warning(f"Sources serialization error (non-fatal): {e}")

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
        query_engine = index.as_query_engine(streaming=True, similarity_top_k=15)

        query_response = query_engine.query(query_text)

        # Capture source nodes BEFORE streaming
        try:
            captured_sources = list(query_response.source_nodes or [])
        except Exception:
            captured_sources = []

        for text in query_response.response_gen:
            yield text
            await asyncio.sleep(0.01)

        try:
            sources_marker = _serialize_sources(captured_sources)
            if sources_marker:
                yield sources_marker
        except Exception as e:
            logging.warning(f"Sources serialization error (non-fatal): {e}")

    except Exception as e:
        logging.error(f"Vision Synthesize Error: {e}")
        yield f"[System Error] Vision analysis failed. Error: {str(e)}"
