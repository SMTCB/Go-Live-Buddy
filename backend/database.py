import os
from pinecone import Pinecone, ServerlessSpec
from llama_index.vector_stores.pinecone import PineconeVectorStore
from llama_index.llms.gemini import Gemini
from llama_index.embeddings.gemini import GeminiEmbedding
from llama_index.core import Settings
from dotenv import load_dotenv

load_dotenv()

# Initialize Pinecone
pc = Pinecone(api_key=os.environ["PINECONE_API_KEY"])
index_name = "golivebuddy"

if index_name not in pc.list_indexes().names():
    pc.create_index(
        name=index_name,
        dimension=768, # Gemini embeddings dimension
        metric="cosine",
        spec=ServerlessSpec(cloud="aws", region="us-east-1")
    )

pinecone_index = pc.Index(index_name)

def get_vector_store(namespace: str):
    return PineconeVectorStore(pinecone_index=pinecone_index, namespace=namespace)

# Configure LlamaIndex defaults globally
Settings.llm = Gemini(model="models/gemini-1.5-pro", api_key=os.environ["GOOGLE_API_KEY"])
Settings.embed_model = GeminiEmbedding(model_name="models/embedding-001", api_key=os.environ["GOOGLE_API_KEY"])
