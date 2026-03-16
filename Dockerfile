FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy everything
COPY . .

RUN mkdir -p conversations files/generated data/user-sops

EXPOSE 8080

ENV HOST=0.0.0.0
ENV PORT=8080

CMD ["python", "-c", "import os,uvicorn;uvicorn.run('backend.main:app',host='0.0.0.0',port=int(os.environ.get('PORT',8080)))"]
