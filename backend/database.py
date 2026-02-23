import os
from pinecone import Pinecone, ServerlessSpec
from llama_index.vector_stores.pinecone import PineconeVectorStore
from llama_index.llms.gemini import Gemini
from llama_index.embeddings.gemini import GeminiEmbedding
from llama_index.core import Settings
from dotenv import load_dotenv, find_dotenv

load_dotenv(find_dotenv())

# Initialize Pinecone safely for Vercel builders
pinecone_key = os.environ.get("PINECONE_API_KEY", "")
google_key = os.environ.get("GOOGLE_API_KEY", "")

pc = Pinecone(api_key=pinecone_key) if pinecone_key else None
index_name = "golivebuddy"

if pc and index_name not in pc.list_indexes().names():
    pc.create_index(
        name=index_name,
        dimension=3072, # Gemini embeddings dimension
        metric="cosine",
        spec=ServerlessSpec(cloud="aws", region="us-east-1")
    )

pinecone_index = pc.Index(index_name) if pc else None

def get_vector_store(namespace: str):
    if not pinecone_index:
        raise ValueError("Pinecone index not initialized. Missing API Keys.")
    return PineconeVectorStore(pinecone_index=pinecone_index, namespace=namespace)

# Configure LlamaIndex defaults globally
if google_key:
    try:
        # Standard model name for LlamaIndex Gemini integration
        Settings.llm = Gemini(model="models/gemini-1.5-flash", api_key=google_key)
        Settings.embed_model = GeminiEmbedding(model_name="models/gemini-embedding-001", api_key=google_key)
    except Exception as e:
        import logging
        logging.error(f"Failed to initialize Gemini models: {e}")
        # Fallback or just let it be None - the app will still start
