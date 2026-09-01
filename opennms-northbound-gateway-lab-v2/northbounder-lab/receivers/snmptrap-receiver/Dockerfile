FROM python:3.12-slim

WORKDIR /app
COPY decoder.py server.py .

# Default 1162 (non-privileged). Map to host :162 if you want the
# standard trap port - see GUIDE.md Part 12.
EXPOSE 1162/udp

CMD ["python3", "server.py"]
