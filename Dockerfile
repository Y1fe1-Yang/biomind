FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend/ ./backend/
COPY scripts/ ./scripts/
COPY frontend/ ./frontend/

# Data, conversations, and generated files are mounted as volumes
RUN mkdir -p data conversations files/generated

EXPOSE 8080

# On server: AI_PROVIDER=claude (raw API, no CC CLI needed)
ENV AI_PROVIDER=claude
ENV HOST=0.0.0.0
ENV PORT=8080

CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8080"]
