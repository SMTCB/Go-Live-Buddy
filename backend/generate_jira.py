import json
import os
from ingest import process_ingestion, ingest_json

def generate_mock_jira():
    tickets = []
    # 10 SAP tickets
    for i in range(1, 11):
        tickets.append({
            "id": f"SAP-{1000+i}",
            "system": "SAP FI",
            "issue": f"User cannot navigate to Fiori app {i}.",
            "resolution": "Instructed user to click the tile group icon at the top-left of the Launchpad."
        })
    # 10 CRM tickets
    for i in range(1, 11):
        tickets.append({
            "id": f"CRM-{2000+i}",
            "system": "Salesforce CRM",
            "issue": f"User cannot convert Lead {i}.",
            "resolution": "Instructed user to click the 'Convert' button in the top right highlight panel."
        })
        
    with open("mock_jira.json", "w") as f:
        json.dump(tickets, f, indent=4)
    print("Generated mock_jira.json with 20 tickets.")
    
    print("Ingesting mock_jira files...")
    ingest_json("mock_jira.json", "sap-pack")
    ingest_json("mock_jira.json", "crm-pack")

def auto_ingest_initial():
    print("Starting auto-ingestion of initial content...")
    # SAP Video
    process_ingestion("https://www.youtube.com/watch?v=yBNmvqBwUAI", "sap-pack", "Standard")
    # CRM Video
    process_ingestion("https://www.youtube.com/watch?v=xLCLrsDcIHk", "crm-pack", "Standard")
    print("Auto-ingestion complete.")

if __name__ == "__main__":
    generate_mock_jira()
    auto_ingest_initial()
