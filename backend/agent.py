import logging
import asyncio

logging.basicConfig(level=logging.INFO)

async def query_agent_stream(query: str, namespace: str):
    logging.info(f"Received query '{query}' for top-nav namespace: {namespace}")
    
    if namespace == 'sap-pack':
        fallback_message = f"[Source: {namespace}] To navigate Fiori, click the tile group icon located at the top-left of the Fiori Launchpad to see your business apps."
    else:
        fallback_message = f"[Source: {namespace}] To convert a Lead in CRM, open the Lead record, click the 'Convert' button in the top right highlight panel, and confirm."
        
    for word in fallback_message.split(" "):
        yield f"{word} "
        await asyncio.sleep(0.05)
