import logging
import asyncio
import base64
from io import BytesIO
import PIL.Image
import google.generativeai as genai
import os
from database import get_vector_store
from llama_index.core import VectorStoreIndex, StorageContext, Settings

logging.basicConfig(level=logging.INFO)

async def query_agent_stream(query: str, namespace: str):
    logging.info(f"Received query '{query}' for top-nav namespace: {namespace}")
    
    try:
        # Retrieve real RAG context
        vector_store = get_vector_store(namespace)
        storage_context = StorageContext.from_defaults(vector_store=vector_store)
        index = VectorStoreIndex.from_vector_store(vector_store, storage_context=storage_context)
        query_engine = index.as_query_engine(streaming=True)
        
        response = query_engine.query(query)
        for text in response.response_gen:
            yield text
            await asyncio.sleep(0.01)
    except Exception as e:
        logging.error(f"Query Error: {e}")
        yield f"[System Error] Server configuration issue. Please ensure your Vercel Environment Variables (`GOOGLE_API_KEY`, `PINECONE_API_KEY`) are fully set up. Error: {str(e)}"

async def analyze_image_stream(messages: list, namespace: str, base64_image: str):
    logging.info(f"Received image analysis request for namespace: {namespace}")
    
    # 1. Decode image from base64
    try:
        image_data = base64.b64decode(base64_image)
        img = PIL.Image.open(BytesIO(image_data))
    except Exception as e:
        yield f"Error decoding image: {e}"
        return

    try:
        # 2. Extract context via Gemini Vision
        api_key = os.environ.get("GOOGLE_API_KEY", "")
        if not api_key:
            raise ValueError("GOOGLE_API_KEY is not set.")
            
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-2.5-flash')
        
        yield "👁️ **Vision Analysis Initiated**\n"
        await asyncio.sleep(0.1)
        
        prompt = "Analyze this screenshot of a software application. Identify any error messages, context, or UI actions the user is attempting. Be concise but descriptive about the technical context."
        response = model.generate_content([prompt, img])
        extracted_text = response.text
        logging.info(f"Vision Extracted Context: {extracted_text}")

        yield f"**Findings:**\n{extracted_text}\n\n---\n\n🔍 **Synthesizing Solution from Knowledge Base...**\n\n"

        # 3. Query Pinecone with extracted text + User's question
        last_user_message = messages[-1]["content"] if messages else ""
        query_text = f"User Question: {last_user_message}\n\nVisual Context from Screenshot: {extracted_text}\n\nPlease provide a solution or next steps explicitly synthesizing the visual context with the documentation."

        vector_store = get_vector_store(namespace)
        storage_context = StorageContext.from_defaults(vector_store=vector_store)
        index = VectorStoreIndex.from_vector_store(vector_store, storage_context=storage_context)
        query_engine = index.as_query_engine(streaming=True)
        
        query_response = query_engine.query(query_text)
        for text in query_response.response_gen:
            yield text
            await asyncio.sleep(0.01)
    except Exception as e:
        logging.error(f"Vision Synthesize Error: {e}")
        yield f"[System Error] Server configuration issue. Please ensure your Vercel Environment Variables (`GOOGLE_API_KEY`, `PINECONE_API_KEY`) are fully set up. Error: {str(e)}"
