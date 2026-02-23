"""
Fast frame extraction script — NO Gemini, NO Pinecone re-embedding.
Downloads the video and saves resized thumbnails to frontend/public/frames/{ns}/
so the frontend can display real video frames in the Source Citations panel.

Run from the project root:
    .\\venv\\Scripts\\activate
    cd backend
    python extract_frames_only.py
"""
import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    import yt_dlp
    import cv2
except ImportError:
    print("❌ yt-dlp and/or opencv-python-headless are not installed.")
    print("   Run:  pip install yt-dlp opencv-python-headless")
    sys.exit(1)

# ── Config ────────────────────────────────────────────────────────────────────
VIDEOS = [
    {
        "url": "https://www.youtube.com/watch?v=yBNmvqBwUAI",
        "namespace": "sap-pack",
        "label": "SAP Fiori Tutorial",
    },
    {
        "url": "https://www.youtube.com/watch?v=xLCLrsDcIHk",
        "namespace": "crm-pack",
        "label": "Salesforce CRM Tutorial",
    },
]
INTERVAL_SEC = 30   # must match original ingestion interval
THUMB_WIDTH  = 640  # pixels
JPEG_QUALITY = 72

HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC_FRAMES = os.path.join(HERE, "..", "frontend", "public", "frames")
TEMP_VIDEO    = os.path.join(HERE, "temp_video.mp4")


def extract_for(video_cfg: dict):
    url       = video_cfg["url"]
    namespace = video_cfg["namespace"]
    label     = video_cfg["label"]
    dest_dir  = os.path.join(PUBLIC_FRAMES, namespace)
    os.makedirs(dest_dir, exist_ok=True)

    print(f"\n{'='*60}")
    print(f"Processing: {label}")
    print(f"URL:        {url}")
    print(f"Saving to:  {dest_dir}")
    print(f"{'='*60}")

    # ── 1. Download video ─────────────────────────────────────────────────────
    print("⬇️  Downloading video (this may take a few minutes)...")
    if os.path.exists(TEMP_VIDEO):
        os.remove(TEMP_VIDEO)
    ydl_opts = {
        "format":    "bestvideo[ext=mp4]/best[ext=mp4]/best",
        "outtmpl":   TEMP_VIDEO,
        "quiet":     False,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])

    if not os.path.exists(TEMP_VIDEO):
        print("❌ Download failed — temp_video.mp4 not found.")
        return

    # ── 2. Extract & resize frames ────────────────────────────────────────────
    print(f"\n🖼️  Extracting frames every {INTERVAL_SEC}s and resizing to {THUMB_WIDTH}px wide...")
    cap = cv2.VideoCapture(TEMP_VIDEO)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    frame_interval = int(fps * INTERVAL_SEC)
    count = 0
    saved = 0

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        if count % frame_interval == 0:
            h, w = frame.shape[:2]
            new_h = max(1, int(h * THUMB_WIDTH / w))
            thumb = cv2.resize(frame, (THUMB_WIDTH, new_h))
            out_path = os.path.join(dest_dir, f"{saved}.jpg")
            cv2.imwrite(out_path, thumb, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
            print(f"  ✅ Saved frame {saved} → {namespace}/{saved}.jpg")
            saved += 1
        count += 1

    cap.release()
    os.remove(TEMP_VIDEO)
    print(f"\n✅ Done! {saved} frames saved to frontend/public/frames/{namespace}/")


if __name__ == "__main__":
    for cfg in VIDEOS:
        extract_for(cfg)

    print("\n" + "="*60)
    print("All frames extracted!")
    print("\nNext step — commit the frames to git so Vercel can serve them:")
    print("  git add frontend/public/frames/")
    print('  git commit -m "feat: add real video frame thumbnails as static assets"')
    print("  git push")
    print("="*60)
