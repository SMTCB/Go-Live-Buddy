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
# Resilient pathing for Vercel vs Local
_PROJ_ROOT = os.path.abspath(os.path.join(_HERE, ".."))
_PUBLIC_FRAMES = os.path.join(_PROJ_ROOT, "frontend", "public", "frames")
if not os.path.isdir(_PUBLIC_FRAMES):
    # Fallback if running from a flat deployment (e.g. backend files mapped to /api)
    _PUBLIC_FRAMES = os.path.join(_PROJ_ROOT, "public", "frames")

logging.info(f"[Agent] Resolved public frames path: {_PUBLIC_FRAMES}")


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
                "text":  (n.node.get_content() or "")[:1500],
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
def _load_frame_image(namespace: str, frame_index: int) -> "PIL.Image.Image | None":
    """
    Load a video frame as a PIL Image.
    Strategy 1 (local dev): read from filesystem.
    Strategy 2 (Railway production): fetch from Vercel static URL via HTTP.
    Returns None if neither strategy works.
    """
    # ── Strategy 1: local filesystem ──────────────────────────────────────────
    frame_path = os.path.join(_PUBLIC_FRAMES, namespace, f"{frame_index}.jpg")
    if os.path.isfile(frame_path):
        logging.info(f"[FocusCoord] ✅ Loading frame from local file: {frame_path}")
        return PIL.Image.open(frame_path)

    # ── Strategy 2: fetch from Vercel static URL ───────────────────────────────
    raw_frontend = os.environ.get("FRONTEND_URL", "").rstrip("/")
    if not raw_frontend:
        logging.warning(
            "[FocusCoord] ❌ Frame not on local disk and FRONTEND_URL is not set. "
            "Set FRONTEND_URL=https://your-app.vercel.app in Railway env vars to enable "
            "Show Me bounding-box in production."
        )
        return None

    # Auto-add https:// if user set the env var without a protocol
    frontend_url = raw_frontend if raw_frontend.startswith("http") else f"https://{raw_frontend}"

    frame_url = f"{frontend_url}/frames/{namespace}/{frame_index}.jpg"
    logging.info(f"[FocusCoord] Local file not found — fetching from: {frame_url}")
    try:
        import urllib.request
        with urllib.request.urlopen(frame_url, timeout=8) as resp:
            data = resp.read()
        img = PIL.Image.open(BytesIO(data))
        logging.info(f"[FocusCoord] ✅ Frame fetched from Vercel ({len(data):,} bytes)")
        return img
    except Exception as ex:
        logging.warning(f"[FocusCoord] ❌ HTTP fetch failed for {frame_url}: {ex}")
        return None


def _get_focus_coord(namespace: str, frame_index: int, query: str) -> dict | None:
    """
    Call Gemini Vision on the saved frame thumbnail and ask for a bounding box
    (in percentage coordinates) around the UI element relevant to the query.
    Returns { x_pct, y_pct, w_pct, h_pct, label } or None.
    """
    img = _load_frame_image(namespace, frame_index)
    if img is None:
        return None

    api_key = os.environ.get("GOOGLE_API_KEY", "")
    if not api_key:
        logging.warning("[FocusCoord] ❌ GOOGLE_API_KEY not set — cannot call Gemini Vision.")
        return None

    try:
        logging.info(f"[FocusCoord] Calling Gemini Vision for frame {frame_index} in {namespace}...")
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")

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
        logging.info(f"[FocusCoord] Gemini raw response: {raw[:300]}")
        # Strip markdown fences if present
        raw = re.sub(r"```[a-z]*\n?", "", raw).strip().rstrip("`").strip()
        coord = json.loads(raw)
        # Validate
        if all(k in coord for k in ("x_pct", "y_pct", "w_pct", "h_pct", "label")):
            logging.info(f"[FocusCoord] ✅ Success: {coord}")
            return coord
        else:
            logging.warning(f"[FocusCoord] ❌ JSON missing required keys: {coord}")
    except json.JSONDecodeError as ex:
        logging.warning(f"[FocusCoord] ❌ JSON parse failed: {ex} | raw was: {raw[:200]}")
    except Exception as ex:
        logging.warning(f"[FocusCoord] ❌ Gemini call failed: {ex}")
    return None


def _get_focus_marker(captured_sources: list, query: str, namespace: str = "") -> str:
    """
    Scan captured sources for ALL video frames, call Gemini Vision on each
    (in parallel, capped at MAX_VIDEO_FRAMES), and return a __FOCUS__ marker
    containing a JSON map: { "frame_index": coord_dict, ... }.
    Returns "" if no coords could be generated.
    """
    MAX_VIDEO_FRAMES = 3  # max parallel Gemini Vision calls

    if not captured_sources:
        logging.info("[ShowMe] No captured sources — skipping.")
        return ""

    # Log all source types
    for i, n in enumerate(captured_sources[:5]):
        meta = n.node.metadata or {}
        logging.info(f"[ShowMe] source[{i}] type={meta.get('type','?')} "
                     f"frame_index={meta.get('frame_index')} "
                     f"score={round(float(n.score or 0), 3)} "
                     f"frame_image_url={meta.get('frame_image_url','')}")

    # Collect unique video sources (deduplicate by frame_index)
    seen_frames: set = set()
    video_tasks: list = []  # (frame_index_int, resolved_namespace)
    for n in captured_sources:
        meta = n.node.metadata or {}
        if meta.get("type") in ("pdf_document", "jira_ticket"):
            continue
        frame_index = meta.get("frame_index")
        if frame_index is None:
            continue
        fi = int(frame_index)
        if fi in seen_frames:
            continue
        seen_frames.add(fi)
        # Resolve namespace
        frame_url = meta.get("frame_image_url", "")
        ns_match = re.search(r"/frames/([^/]+)/", frame_url) if frame_url else None
        resolved_ns = ns_match.group(1) if ns_match else namespace
        if resolved_ns:
            video_tasks.append((fi, resolved_ns))
        if len(video_tasks) >= MAX_VIDEO_FRAMES:
            break

    if not video_tasks:
        logging.info("[ShowMe] No video sources with frame_index — skipping.")
        return ""

    logging.info(f"[ShowMe] Generating focus coords for {len(video_tasks)} video frame(s) in parallel…")

    # ── Run Gemini Vision calls in parallel ───────────────────────────────────
    import concurrent.futures

    def _call(task):
        fi, ns = task
        coord = _get_focus_coord(ns, fi, query)
        return str(fi), coord

    coords_map: dict = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_VIDEO_FRAMES) as pool:
        for frame_key, coord in pool.map(_call, video_tasks):
            if coord is not None:
                coords_map[frame_key] = coord
                logging.info(f"[ShowMe] ✅ coord for frame {frame_key}: {coord}")
            else:
                logging.info(f"[ShowMe] ⚠️  No coord returned for frame {frame_key}")

    if not coords_map:
        logging.info("[ShowMe] All Gemini Vision calls returned None — no Show Me marker.")
        return ""

    logging.info(f"[ShowMe] ✅ Returning coords map with {len(coords_map)} frame(s).")
    return f"\n\n{FOCUS_MARKER_START}{json.dumps(coords_map)}{FOCUS_MARKER_END}"



# ── Query stream ──────────────────────────────────────────────────────────────
async def query_agent_stream(query: str, namespace: str):
    logging.info(f"Received query '{query}' for namespace: {namespace}")
    try:
        vector_store = get_vector_store(namespace)
        storage_context = StorageContext.from_defaults(vector_store=vector_store)
        index = VectorStoreIndex.from_vector_store(vector_store, storage_context=storage_context)
        query_engine = index.as_query_engine(streaming=True, similarity_top_k=15)

        from llama_index.core import PromptTemplate
        qa_prompt_tmpl_str = (
            "Context information is below.\n"
            "---------------------\n"
            "{context_str}\n"
            "---------------------\n"
            "Given the context information and NOT prior knowledge, answer the query.\n"
            "Be extremely helpful. If the context does not contain the exact direct answer, but contains related steps, clues, or partial information that could assist the user, use it to synthesize a helpful response rather than refusing to answer.\n"
            "Query: {query_str}\n"
            "Answer: "
        )
        query_engine.update_prompts(
            {"response_synthesizer:text_qa_template": PromptTemplate(qa_prompt_tmpl_str)}
        )

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
                    pool, _get_focus_marker, captured_sources, query, namespace
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
        model = genai.GenerativeModel("gemini-2.0-flash")

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

        # Focus coord marker (same as query_agent_stream)
        try:
            import concurrent.futures
            loop = asyncio.get_event_loop()
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                focus_marker = await loop.run_in_executor(
                    pool, _get_focus_marker, captured_sources, query_text, namespace
                )
            if focus_marker:
                yield focus_marker
        except Exception as e:
            logging.warning(f"Focus coord error (non-fatal): {e}")

    except Exception as e:
        logging.error(f"Vision Synthesize Error: {e}")
        yield f"[System Error] Vision analysis failed. Error: {str(e)}"
