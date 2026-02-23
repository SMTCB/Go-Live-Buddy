import logging
import asyncio
import base64
import json
import os
import re
from io import BytesIO
import PIL.Image
import google.generativeai as genai
from database import get_vector_store
from llama_index.core import VectorStoreIndex, StorageContext, Settings

logging.basicConfig(level=logging.INFO)

# ── Constants ─────────────────────────────────────────────────────────────────
SOURCE_SCORE_THRESHOLD = 0.3
FOCUS_MARKER_START     = "__FOCUS__"
FOCUS_MARKER_END       = "__END_FOCUS__"
_HERE = os.path.dirname(os.path.abspath(__file__))
_PUBLIC_FRAMES = os.path.join(_HERE, "..", "frontend", "public", "frames")


# ── Source serialisation ──────────────────────────────────────────────────────
def _serialize_sources(source_nodes: list) -> str:
    """
    Return the best source per content type (video, pdf_document, jira_ticket)
    then fill remaining slots up to MAX_SOURCES from top scorers.
    """
    MAX_SOURCES = 5
    candidates = [n for n in source_nodes if (n.score or 0) >= SOURCE_SCORE_THRESHOLD]
    if not candidates:
        return ""

    def node_type(n):
        return (n.node.metadata or {}).get("type", "video")

    def to_dict(n):
        try:
            return {
                "text":  (n.node.get_content() or "")[:500],
                "score": round(float(n.score or 0), 3),
                "metadata": {k: v for k, v in (n.node.metadata or {}).items()
                             if k in ("source", "frame_index", "content_tier", "type",
                                      "page_label", "ticket_id", "frame_image_url")},
            }
        except Exception as ex:
            logging.warning(f"Source node serialisation failed: {ex}")
            return None

    # Step 1 — best per type
    type_priority = ["video", "pdf_document", "jira_ticket"]
    best_by_type: dict = {}
    for n in candidates:
        t = node_type(n)
        if t not in best_by_type:
            best_by_type[t] = n
        if len(best_by_type) == len(type_priority):
            break

    selected_ids = {id(n) for n in best_by_type.values()}
    diverse = list(best_by_type.values())

    # Step 2 — fill remaining slots
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


# ── "Show Me" Focus Coordinate ────────────────────────────────────────────────
def _get_focus_coord(namespace: str, frame_index: int, query: str) -> dict | None:
    """
    Call Gemini Vision on the saved frame thumbnail and ask for a bounding box
    (in percentage coordinates) around the UI element relevant to the query.
    Returns { x_pct, y_pct, w_pct, h_pct, label } or None.
    """
    frame_path = os.path.join(_PUBLIC_FRAMES, namespace, f"{frame_index}.jpg")
    if not os.path.isfile(frame_path):
        logging.info(f"Frame image not found locally: {frame_path}")
        return None

    try:
        api_key = os.environ.get("GOOGLE_API_KEY", "")
        if not api_key:
            return None

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.5-flash")
        img = PIL.Image.open(frame_path)

        prompt = (
            f"The user needs help with: {query}\n\n"
            "Look at this UI screenshot. Identify the SINGLE most relevant interactive element "
            "(button, field, link, menu item) the user needs to click or interact with to "
            "perform the action described.\n\n"
            "Return ONLY a JSON object, no markdown, no explanation:\n"
            '{"x_pct": <left edge as % of image width, integer 0-100>, '
            '"y_pct": <top edge as % of image height, integer 0-100>, '
            '"w_pct": <element width as % of image width, integer 1-100>, '
            '"h_pct": <element height as % of image height, integer 1-100>, '
            '"label": "<short element name>"}\n\n'
            "If no specific element is clearly relevant, return "
            '{"x_pct": 10, "y_pct": 10, "w_pct": 80, "h_pct": 80, "label": "Screen area"}'
        )
        response = model.generate_content([prompt, img])
        raw = (response.text or "").strip()
        # Strip markdown fences if present
        raw = re.sub(r"```[a-z]*\n?", "", raw).strip().rstrip("`").strip()
        coord = json.loads(raw)
        # Validate
        if all(k in coord for k in ("x_pct", "y_pct", "w_pct", "h_pct", "label")):
            return coord
    except Exception as ex:
        logging.warning(f"Focus coord call failed: {ex}")
    return None


def _get_focus_marker(captured_sources: list, query: str) -> str:
    """
    If the best source is a video frame and the image exists locally, call Gemini
    Vision and return a __FOCUS__ marker string; otherwise return "".
    """
    if not captured_sources:
        return ""
    top = captured_sources[0]
    top_meta = top.node.metadata or {}
    top_type = top_meta.get("type", "video")
    if top_type in ("pdf_document", "jira_ticket"):
        return ""  # Show Me only for visual sources

    frame_index = top_meta.get("frame_index")
    # Derive namespace from frame_image_url (e.g. /frames/sap-pack/17.jpg)
    frame_url = top_meta.get("frame_image_url", "")
    ns_match = re.search(r"/frames/([^/]+)/", frame_url) if frame_url else None
    if not ns_match:
        return ""
    namespace = ns_match.group(1)

    if frame_index is None:
        return ""

    coord = _get_focus_coord(namespace, int(frame_index), query)
    if not coord:
        return ""
    return f"\n\n{FOCUS_MARKER_START}{json.dumps(coord)}{FOCUS_MARKER_END}"


# ── Query stream ──────────────────────────────────────────────────────────────
async def query_agent_stream(query: str, namespace: str):
    logging.info(f"Received query '{query}' for namespace: {namespace}")
    try:
        vector_store = get_vector_store(namespace)
        storage_context = StorageContext.from_defaults(vector_store=vector_store)
        index = VectorStoreIndex.from_vector_store(vector_store, storage_context=storage_context)
        query_engine = index.as_query_engine(streaming=True, similarity_top_k=15)

        response = query_engine.query(query)

        # Capture source nodes BEFORE consuming the streaming generator
        try:
            captured_sources = list(response.source_nodes or [])
        except Exception:
            captured_sources = []

        for text in response.response_gen:
            yield text
            await asyncio.sleep(0.01)

        # Sources marker
        try:
            sources_marker = _serialize_sources(captured_sources)
            if sources_marker:
                yield sources_marker
        except Exception as e:
            logging.warning(f"Sources serialisation error: {e}")

        # Focus coord marker (async wrapper so we don't block the event loop too long)
        try:
            import concurrent.futures
            loop = asyncio.get_event_loop()
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                focus_marker = await loop.run_in_executor(
                    pool, _get_focus_marker, captured_sources, query
                )
            if focus_marker:
                yield focus_marker
        except Exception as e:
            logging.warning(f"Focus coord error (non-fatal): {e}")

    except Exception as e:
        logging.error(f"Query Error: {e}")
        yield f"[System Error] Unable to query knowledge base. Error: {str(e)}"


# ── Image analysis stream ─────────────────────────────────────────────────────
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
        model = genai.GenerativeModel("gemini-2.5-flash")

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
            "Provide a solution synthesizing both the visual context and documentation."
        )

        vector_store = get_vector_store(namespace)
        storage_context = StorageContext.from_defaults(vector_store=vector_store)
        index = VectorStoreIndex.from_vector_store(vector_store, storage_context=storage_context)
        query_engine = index.as_query_engine(streaming=True, similarity_top_k=15)

        query_response = query_engine.query(query_text)

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
            logging.warning(f"Sources serialisation error: {e}")

    except Exception as e:
        logging.error(f"Vision Synthesize Error: {e}")
        yield f"[System Error] Vision analysis failed. Error: {str(e)}"
