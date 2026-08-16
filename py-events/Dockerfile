FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY send_event.py .

# Keep the container alive so you can `podman exec` into it interactively for
# the tutorial. In production you'd run this as a one-shot job or a
# cron/Kubernetes CronJob instead (see the Roadmap section of the guide).
CMD ["sleep", "infinity"]
