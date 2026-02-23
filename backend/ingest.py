import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv, find_dotenv
load_dotenv(find_dotenv())

import json
import queue
import time
import PIL.Image
import google.generativeai as genai

try:
    import yt_dlp
    import cv2
    HAS_VIDEO = True
except ImportError:
    HAS_VIDEO = False

try:
    import requests as req_lib
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

from llama_index.core import SimpleDirectoryReader, VectorStoreIndex, StorageContext, Document
from database import get_vector_store
import tempfile


def ingest_json(file_path: str, namespace: str):
    print(f"Ingesting JSON tickets to namespace '{namespace}': {file_path}")
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}")
        return

    with open(file_path, 'r') as f:
        data = json.load(f)

    docs = []
    for ticket in data:
        system = ticket.get("system", "")
        if namespace == "sap-pack" and "SAP" not in system:
            continue
        if namespace == "crm-pack" and "CRM" not in system:
            continue
        ticket_id = ticket.get("id", "UNKNOWN")
        text = (
            f"Ticket ID: {ticket_id}\n"
            f"System: {system}\n"
            f"Issue: {ticket.get('issue', '')}\n"
            f"Resolution: {ticket.get('resolution', '')}"
        )
        doc = Document(
            text=text,
            metadata={
                "source": file_path,
                "type": "jira_ticket",
                "ticket_id": ticket_id,
                "system": system,
            }
        )
        docs.append(doc)

    if docs:
        vector_store = get_vector_store(namespace)
        storage_context = StorageContext.from_defaults(vector_store=vector_store)
        VectorStoreIndex.from_documents(docs, storage_context=storage_context)
        print(f"Upserted {len(docs)} tickets to '{namespace}'")


def ingest_pdf(file_path: str, namespace: str, source_url: str = "", content_tier: str = "Standard"):
    """Ingest a local PDF into Pinecone, preserving page_label metadata."""
    print(f"Ingesting PDF to namespace '{namespace}': {file_path}")
    documents = SimpleDirectoryReader(input_files=[file_path]).load_data()

    for doc in documents:
        # LlamaIndex/pypdf provides page_label automatically — make sure it's in metadata
        page_label = doc.metadata.get("page_label") or doc.metadata.get("page_number")
        doc.metadata.update({
            "source": source_url or file_path,
            "type": "pdf_document",
            "content_tier": content_tier,
            "page_label": str(page_label) if page_label is not None else "",
        })

    vector_store = get_vector_store(namespace)
    storage_context = StorageContext.from_defaults(vector_store=vector_store)
    VectorStoreIndex.from_documents(documents, storage_context=storage_context)
    print(f"Upserted {len(documents)} PDF chunks to '{namespace}'")
    return len(documents)


def _frames_output_dir(tech_category: str) -> str:
    """Return the path to save frames as Next.js static assets."""
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(here, "..", "frontend", "public", "frames", tech_category)


def extract_frames(video_path: str, output_dir: str, namespace: str,
                   interval_sec: int = 30, thumb_width: int = 640):
    """
    Extract frames from video, save them as compressed JPEGs to the
    Next.js public/frames/{namespace}/ directory, and return count.
    """
    os.makedirs(output_dir, exist_ok=True)
    public_dir = _frames_output_dir(namespace)
    os.makedirs(public_dir, exist_ok=True)

    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    frame_interval = int(fps * interval_sec)
    count = 0
    saved = 0
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        if count % frame_interval == 0:
            # Save full-quality working copy for Gemini
            cv2.imwrite(os.path.join(output_dir, f"frame_{saved:04d}.jpg"), frame)
            # Save resized thumbnail for frontend display
            h, w = frame.shape[:2]
            new_w = thumb_width
            new_h = int(h * new_w / w)
            thumb = cv2.resize(frame, (new_w, new_h))
            cv2.imwrite(
                os.path.join(public_dir, f"{saved}.jpg"),
                thumb,
                [cv2.IMWRITE_JPEG_QUALITY, 70]
            )
            saved += 1
        count += 1
    cap.release()
    return saved


def process_ingestion(source_url: str, tech_category: str, content_tier: str, progress_cb=None):
    def progress(msg):
        print(msg)
        if progress_cb:
            progress_cb(msg)

    progress(f"📥 Starting ingestion of [{content_tier}] → '{tech_category}': {source_url}")

    # ── YouTube video ──────────────────────────────────────────────────────────
    if "youtube.com" in source_url or "youtu.be" in source_url:
        if not HAS_VIDEO:
            progress("❌ yt-dlp / cv2 not available. Run ingestion locally.")
            return False

        progress("🎬 Detected YouTube URL. Downloading via yt-dlp...")
        ydl_opts = {
            'format': 'bestvideo[ext=mp4]/best[ext=mp4]/best',
            'outtmpl': 'temp_video.%(ext)s',
            'quiet': True,
            'no_warnings': True,
        }
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(source_url, download=True)
                video_title = info.get('title', 'video')
            progress(f"✅ Video '{video_title}' downloaded.")

            frame_dir = f"extracted_frames_{tech_category}"
            progress("🖼️ Extracting frames every 30s + saving thumbnails to frontend/public/frames/...")
            num_frames = extract_frames(
                "temp_video.mp4",
                frame_dir,
                namespace=tech_category,
                interval_sec=30,
                thumb_width=640
            )
            progress(f"📷 Extracted {num_frames} frames.")

            genai.configure(api_key=os.environ.get("GOOGLE_API_KEY", ""))
            model = genai.GenerativeModel('gemini-1.5-flash')

            docs = []
            for i in range(num_frames):
                frame_path = os.path.join(frame_dir, f"frame_{i:04d}.jpg")
                try:
                    img = PIL.Image.open(frame_path)
                    prompt = (
                        f"Describe this educational video frame in detail. Extract any visible text, "
                        f"identify UI elements, and explain the software actions shown. "
                        f"Technology Context: {tech_category}."
                    )
                    response = model.generate_content([prompt, img])
                    description = response.text
                    doc = Document(
                        text=description,
                        metadata={
                            "source": source_url,
                            "frame_index": i,
                            "content_tier": content_tier,
                            # Relative URL served as Next.js static asset
                            "frame_image_url": f"/frames/{tech_category}/{i}.jpg",
                        }
                    )
                    docs.append(doc)
                    progress(f"  ✅ Frame {i + 1}/{num_frames} described")
                    time.sleep(2)
                except Exception as ex:
                    progress(f"  ⚠️ Frame {i} failed: {ex}")

            if docs:
                vector_store = get_vector_store(tech_category)
                storage_context = StorageContext.from_defaults(vector_store=vector_store)
                VectorStoreIndex.from_documents(docs, storage_context=storage_context)
                progress(f"✅ Upserted {len(docs)} frame descriptions to '{tech_category}'")

            if os.path.exists("temp_video.mp4"):
                os.remove("temp_video.mp4")
            return True

        except Exception as e:
            progress(f"❌ Video ingestion error: {e}")
            return False

    # ── PDF / Document URL ─────────────────────────────────────────────────────
    elif source_url.lower().endswith(".pdf") or "pdf" in source_url.lower():
        if not HAS_REQUESTS:
            progress("❌ 'requests' library not available. Cannot download PDF.")
            return False
        try:
            progress("📄 Detected PDF URL. Downloading document...")
            headers = {"User-Agent": "Mozilla/5.0 (compatible; GoLiveBuddy/1.0)"}
            response = req_lib.get(source_url, headers=headers, timeout=180, stream=True)
            response.raise_for_status()
            content_length = int(response.headers.get("Content-Length", 0))
            progress(f"📦 PDF size: {round(content_length / 1024 / 1024, 1)} MB. Saving...")

            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                for chunk in response.iter_content(chunk_size=65536):
                    tmp.write(chunk)
                tmp_path = tmp.name

            progress("🧠 Parsing PDF and splitting into chunks...")
            try:
                num_chunks = ingest_pdf(tmp_path, tech_category, source_url=source_url, content_tier=content_tier)
                progress(f"✅ Ingested {num_chunks} PDF chunks into '{tech_category}'")
                return True
            finally:
                os.remove(tmp_path)

        except Exception as e:
            progress(f"❌ PDF ingestion error: {e}")
            return False

    else:
        progress("⚠️ Unsupported source. Provide a YouTube URL or a direct PDF link.")
        return False
