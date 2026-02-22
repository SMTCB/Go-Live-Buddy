from database import get_vector_store, pinecone_index
from llama_index.core import VectorStoreIndex
import logging
import asyncio

logging.basicConfig(level=logging.INFO)

def classify_query(query: str) -> str:
    """Classify the query into 'sap-pack' or 'crm-pack' based on keywords."""
    query_lower = query.lower()
    if 'sap' in query_lower or 'fiori' in query_lower or 'launchpad' in query_lower:
        return 'sap-pack'
    if 'salesforce' in query_lower or 'crm' in query_lower or 'opportunity' in query_lower or 'lead' in query_lower:
        return 'crm-pack'
    # Default to a generic search or fallback
    return 'sap-pack'

async def query_agent_stream(query: str):
    namespace = classify_query(query)
    logging.info(f"Routed query '{query}' to namespace: {namespace}")
    
    try:
        vector_store = get_vector_store(namespace)
        index = VectorStoreIndex.from_vector_store(vector_store)
        
        query_engine = index.as_query_engine(streaming=True, similarity_top_k=2)
        response_stream = query_engine.query(query)
        
        # Generate streaming text
        for text in response_stream.response_gen:
            yield text
    except Exception as e:
        logging.error(f"Index querying failed: {e}")
        # Fallback mechanism if vector database is empty or connection fails for PoC
        fallback_message = f"Go-Live Buddy Router intercepted your query. Directed to namespace: [{namespace}]. "
        fallback_message += f"\n\nI'm ready to assist with {namespace.upper()} related questions. Currently standing by since Pinecone index is empty."
        for word in fallback_message.split(" "):
            yield f"{word} "
            await asyncio.sleep(0.05)
