import os
from dotenv import load_dotenv, find_dotenv
from llama_index.core import SimpleDirectoryReader, VectorStoreIndex, StorageContext, Document
from database import get_vector_store
import sys
import yt_dlp
import cv2
import json
import google.generativeai as genai
import PIL.Image

load_dotenv(find_dotenv())

def ingest_json(file_path: str, namespace: str):
    print(f"Ingesting JSON tickets to namespace '{namespace}': {file_path}")
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}")
        return
        
    with open(file_path, 'r') as f:
        data = json.load(f)
        
    docs = []
    for ticket in data:
        # Simple match for tickets to namespace
        if namespace == "sap-pack" and "SAP" not in ticket.get("system", ""): continue
        if namespace == "crm-pack" and "CRM" not in ticket.get("system", ""): continue
        
        text = f"Ticket ID: {ticket['id']}\nSystem: {ticket['system']}\nIssue: {ticket['issue']}\nResolution: {ticket['resolution']}"
        doc = Document(text=text, metadata={"source": file_path, "type": "jira_ticket"})
        docs.append(doc)
        
    if docs:
        vector_store = get_vector_store(namespace)
        storage_context = StorageContext.from_defaults(vector_store=vector_store)
        VectorStoreIndex.from_documents(docs, storage_context=storage_context)
        print(f"Successfully upserted {len(docs)} tickets to '{namespace}'")

def ingest_pdf(file_path: str, namespace: str):
    print(f"Ingesting PDF to namespace '{namespace}': {file_path}")
    documents = SimpleDirectoryReader(input_files=[file_path]).load_data()
    
    vector_store = get_vector_store(namespace)
    storage_context = StorageContext.from_defaults(vector_store=vector_store)
    
    VectorStoreIndex.from_documents(
        documents,
        storage_context=storage_context,
    )
    print(f"Successfully upserted {len(documents)} chunks to '{namespace}'")

import time

def extract_frames(video_path: str, output_dir: str, interval_sec: int = 30):
    os.makedirs(output_dir, exist_ok=True)
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0:
        fps = 30
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

def process_ingestion(source_url: str, tech_category: str, content_tier: str) -> bool:
    print(f"Ingesting [{content_tier}] to '{tech_category}': {source_url}")
    
    if "youtube.com" in source_url or "youtu.be" in source_url:
        print("Detected YouTube URL. Downloading via yt-dlp...")
        ydl_opts = {
            'format': 'bestvideo[ext=mp4]/best[ext=mp4]/best',
            'outtmpl': 'temp_video.%(ext)s',
            'quiet': True,
            'no_warnings': True,
        }
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([source_url])
            
            print("Video downloaded. Extracting frames via cv2...")
            num_frames = extract_frames("temp_video.mp4", f"extracted_frames_{tech_category}")
            print(f"Extracted {num_frames} frames.")
            
            print(f"Generating multimodal descriptions and upserting for namespace: {tech_category}")
            genai.configure(api_key=os.environ["GOOGLE_API_KEY"])
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
                    time.sleep(2) # Avoid rate limits
                except Exception as ex:
                    print(f"Failed to process frame {i}: {ex}")

            if docs:
                vector_store = get_vector_store(tech_category)
                storage_context = StorageContext.from_defaults(vector_store=vector_store)
                VectorStoreIndex.from_documents(docs, storage_context=storage_context)
                print(f"Successfully upserted {len(docs)} frame descriptions to '{tech_category}'")
            
            # Cleanup
            if os.path.exists("temp_video.mp4"):
                os.remove("temp_video.mp4")
                
            return True
        except Exception as e:
            print(f"Ingestion Error: {e}")
            return False
            
    # Mocking for PDF/other types
    print("Mocking ingestion for non-YouTube source.")
    return True

if __name__ == "__main__":
    # Example usage
    process_ingestion("https://www.youtube.com/watch?v=yBNmvqBwUAI", "sap-pack", "Standard")
    process_ingestion("https://www.youtube.com/watch?v=xLCLrsDcIHk", "crm-pack", "Standard")
