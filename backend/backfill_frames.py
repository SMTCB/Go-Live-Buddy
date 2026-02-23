"""
Backfill script: copy already-extracted frame JPEGs into frontend/public/frames/{namespace}/
and update Pinecone metadata with frame_image_url so the frontend can show actual frames.

Run from the project root:
    .\\venv\\Scripts\\activate
    cd backend
    python backfill_frames.py

This is a one-time operation per namespace. If you re-ingest a video, frames are saved
automatically and this script is no longer needed for that namespace.
"""
import sys
import os
import shutil
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv, find_dotenv
load_dotenv(find_dotenv())

from database import get_vector_store
from pinecone import Pinecone

NAMESPACES = {
    "sap-pack": "extracted_frames_sap-pack",
    "crm-pack": "extracted_frames_crm-pack",
}

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND_PUBLIC = os.path.join(HERE, "..", "frontend", "public", "frames")


def backfill(namespace: str, frames_dir: str):
    print(f"\n=== Backfilling namespace: {namespace} ===")

    if not os.path.isdir(frames_dir):
        print(f"  ⚠️  Frame directory not found: {frames_dir}")
        print(f"  ℹ️  Re-ingest the video to regenerate frames.")
        return

    dest_dir = os.path.join(FRONTEND_PUBLIC, namespace)
    os.makedirs(dest_dir, exist_ok=True)

    frames = sorted(f for f in os.listdir(frames_dir) if f.endswith(".jpg"))
    if not frames:
        print(f"  ⚠️ No JPEGs found in {frames_dir}")
        return

    print(f"  Found {len(frames)} frames. Copying to {dest_dir}...")
    for frame_file in frames:
        # frame_0017.jpg → index 17
        idx_str = frame_file.replace("frame_", "").replace(".jpg", "").lstrip("0") or "0"
        idx = int(idx_str)
        src = os.path.join(frames_dir, frame_file)
        dst = os.path.join(dest_dir, f"{idx}.jpg")
        shutil.copy2(src, dst)
        print(f"  ✅ Copied → {namespace}/{idx}.jpg")

    print(f"\n  {len(frames)} frames copied to frontend/public/frames/{namespace}/")
    print("  ✅ Backfill complete. Commit frontend/public/frames/ to git to deploy them.")


if __name__ == "__main__":
    for ns, fd in NAMESPACES.items():
        backfill(ns, fd)
