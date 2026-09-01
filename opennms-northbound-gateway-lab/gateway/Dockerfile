FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# 8000 = REST (FastAPI/uvicorn), 50051 = gRPC
EXPOSE 8000 50051

# The gRPC server is started from within app/main.py's lifespan hook
# (see app/main.py), so a single process serves both protocols.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
