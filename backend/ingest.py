import os
import sys
import tempfile
import time
import json
from dotenv import load_dotenv, find_dotenv
from llama_index.core import SimpleDirectoryReader, VectorStoreIndex, StorageContext, Document
from database import get_vector_store

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(find_dotenv())

try:
    import yt_dlp
    import cv2
except ImportError:
    pass  # Optional: only needed locally for video ingestion

try:
    import requests as req_lib
except ImportError:
    req_lib = None

import google.generativeai as genai
import PIL.Image


def ingest_json(file_path: str, namespace: str):
    print(f"Ingesting JSON tickets to namespace '{namespace}': {file_path}")
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}")
        return

    import json
    with open(file_path, 'r') as f:
        data = json.load(f)

    docs = []
    for ticket in data:
        if namespace == "sap-pack" and "SAP" not in ticket.get("system", ""):
            continue
        if namespace == "crm-pack" and "CRM" not in ticket.get("system", ""):
            continue
        text = f"Ticket ID: {ticket['id']}\nSystem: {ticket['system']}\nIssue: {ticket['issue']}\nResolution: {ticket['resolution']}"
        doc = Document(text=text, metadata={"source": file_path, "type": "jira_ticket"})
        docs.append(doc)

    if docs:
        vector_store = get_vector_store(namespace)
        storage_context = StorageContext.from_defaults(vector_store=vector_store)
        VectorStoreIndex.from_documents(docs, storage_context=storage_context)
        print(f"Successfully upserted {len(docs)} tickets to '{namespace}'")


def ingest_pdf(file_path: str, namespace: str, source_url: str = "", content_tier: str = "Standard"):
    """Ingest a local PDF file into Pinecone."""
    print(f"Ingesting PDF to namespace '{namespace}': {file_path}")
    documents = SimpleDirectoryReader(input_files=[file_path]).load_data()

    # Tag all documents with source metadata
    for doc in documents:
        doc.metadata.update({
            "source": source_url or file_path,
            "type": "pdf_document",
            "content_tier": content_tier,
        })

    vector_store = get_vector_store(namespace)
    storage_context = StorageContext.from_defaults(vector_store=vector_store)
    VectorStoreIndex.from_documents(documents, storage_context=storage_context)
    print(f"Successfully upserted {len(documents)} PDF chunks to '{namespace}'")
    return len(documents)


def extract_frames(video_path: str, output_dir: str, interval_sec: int = 30):
    os.makedirs(output_dir, exist_ok=True)
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
            cv2.imwrite(os.path.join(output_dir, f"frame_{saved:04d}.jpg"), frame)
            saved += 1
        count += 1
    cap.release()
    return saved


def process_ingestion(source_url: str, tech_category: str, content_tier: str, progress_cb=None):
    """
    Main ingestion entry point.
    progress_cb(msg: str) is called with progress updates if provided.
    Returns True on success, False on failure.
    """
    def progress(msg):
        print(msg)
        if progress_cb:
            progress_cb(msg)

    progress(f"📥 Starting ingestion of [{content_tier}] to '{tech_category}': {source_url}")

    # ── YouTube video ──────────────────────────────────────────────────────────
    if "youtube.com" in source_url or "youtu.be" in source_url:
        progress("🎬 Detected YouTube URL. Downloading via yt-dlp...")
        ydl_opts = {
            'format': 'bestvideo[ext=mp4]/best[ext=mp4]/best',
            'outtmpl': 'temp_video.%(ext)s',
            'quiet': True,
            'no_warnings': True,
        }
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([source_url])

            progress("🖼️ Video downloaded. Extracting frames every 30s...")
            num_frames = extract_frames("temp_video.mp4", f"extracted_frames_{tech_category}")
            progress(f"📷 Extracted {num_frames} frames. Generating descriptions with Gemini Vision...")

            genai.configure(api_key=os.environ.get("GOOGLE_API_KEY", ""))
            model = genai.GenerativeModel('gemini-2.5-flash')

            docs = []
            frame_dir = f"extracted_frames_{tech_category}"
            for i in range(num_frames):
                frame_path = os.path.join(frame_dir, f"frame_{i:04d}.jpg")
                try:
                    img = PIL.Image.open(frame_path)
                    prompt = f"Describe this educational video frame in detail. Extract any text visible, identify UI elements, and explain the software actions shown. Technology Context: {tech_category}."
                    response = model.generate_content([prompt, img])
                    description = response.text
                    doc = Document(
                        text=description,
                        metadata={"source": source_url, "frame_index": i, "content_tier": content_tier}
                    )
                    docs.append(doc)
                    progress(f"  ✅ Frame {i+1}/{num_frames} described")
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
        if req_lib is None:
            progress("❌ 'requests' library not available. Cannot download PDF.")
            return False
        try:
            progress("📄 Detected PDF URL. Downloading document...")
            headers = {"User-Agent": "Mozilla/5.0 (compatible; GoLiveBuddy/1.0)"}
            response = req_lib.get(source_url, headers=headers, timeout=120, stream=True)
            response.raise_for_status()

            content_length = int(response.headers.get("Content-Length", 0))
            progress(f"📦 PDF size: {round(content_length / 1024 / 1024, 1)} MB. Saving...")

            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                for chunk in response.iter_content(chunk_size=8192):
                    tmp.write(chunk)
                tmp_path = tmp.name

            progress("🧠 Parsing PDF and splitting into chunks...")
            try:
                num_chunks = ingest_pdf(tmp_path, tech_category, source_url=source_url, content_tier=content_tier)
                progress(f"✅ Successfully ingested {num_chunks} document chunks to '{tech_category}'")
                return True
            finally:
                os.remove(tmp_path)

        except req_lib.exceptions.HTTPError as e:
            progress(f"❌ HTTP error downloading PDF: {e}")
            return False
        except Exception as e:
            progress(f"❌ PDF ingestion error: {e}")
            return False

    else:
        progress(f"⚠️ Unsupported source type. Please provide a YouTube URL or a direct PDF link (.pdf extension).")
        return False


if __name__ == "__main__":
    from generate_jira import generate_mock_jira
    generate_mock_jira()
