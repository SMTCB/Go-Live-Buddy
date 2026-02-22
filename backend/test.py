import os
from dotenv import load_dotenv, find_dotenv
import google.generativeai as genai

load_dotenv(find_dotenv())

genai.configure(api_key=os.environ["GOOGLE_API_KEY"])

print("Available embed models:")
for m in genai.list_models():
    if "embedContent" in m.supported_generation_methods:
        print(m.name)
