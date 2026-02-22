import os
from dotenv import load_dotenv
from llama_index.core import SimpleDirectoryReader, VectorStoreIndex, StorageContext
from database import get_vector_store
import sys

load_dotenv()

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

def ingest_video_mock(video_url: str, namespace: str):
    """
    Mock ingestion: In reality, we'd use cv2 to extract frames every 10s,
    use a multimodal model (Gemini 1.5 Pro) to describe them or directly embed them,
    and transcribe audio via Whisper. 
    Here we simulate saving metadata.
    """
    print(f"Mock ingesting video from {video_url} into '{namespace}'...")
    print("Extracting frames every 10s...")
    print("Transcribing audio...")
    print("Upserting multimodal embeddings to Pinecone...")
    print("Done.")

if __name__ == "__main__":
    # Example usage
    ingest_video_mock("https://www.youtube.com/watch?v=yBNmvqBwUAI", "sap-pack")
    ingest_video_mock("https://www.youtube.com/watch?v=xLCLrsDcIHk", "crm-pack")
    
    # PDF ingestion would look like:
    # ingest_pdf("../data/FSD_OP2023_latest.pdf", "sap-pack")
