from dotenv import load_dotenv
import os

load_dotenv()

# AI provider: "claude" (default) or "kimi"
AI_PROVIDER = os.getenv("AI_PROVIDER", "claude")

CLAUDE_API_KEY = os.getenv("CLAUDE_API_KEY", os.getenv("ANTHROPIC_API_KEY", ""))
KIMI_API_KEY = os.getenv("KIMI_API_KEY", "")

JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production-use-a-long-random-string")

HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8080"))
ZHIPU_API_KEY = os.getenv("ZHIPU_API_KEY", "")
