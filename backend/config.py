from dotenv import load_dotenv
import os

load_dotenv()

KIMI_API_KEY = os.getenv("KIMI_API_KEY", "")
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8080"))
