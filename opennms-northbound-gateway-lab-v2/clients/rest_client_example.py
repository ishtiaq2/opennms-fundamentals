"""
Quick REST client example against the Northbound Gateway.

Usage:
    GATEWAY_API_KEY=test-key-123 python3 clients/rest_client_example.py
"""
import os

import httpx

BASE_URL = os.getenv("GATEWAY_REST_URL", "http://localhost:8000")
API_KEY = os.getenv("GATEWAY_API_KEY", "demo-key-123")


def main():
    headers = {"X-API-Key": API_KEY}
    with httpx.Client(base_url=BASE_URL, headers=headers, timeout=10) as client:
        print("== health ==")
        print(client.get("/health").json())

        print("== list nodes ==")
        resp = client.get("/api/v1/nodes", params={"limit": 5})
        print(resp.status_code, resp.json())

        print("== get node 2 ==")
        resp = client.get("/api/v1/nodes/2")
        print(resp.status_code, resp.json())

        print("== list alarms (CRITICAL) ==")
        resp = client.get("/api/v1/alarms", params={"severity": "CRITICAL", "limit": 5})
        print(resp.status_code, resp.json())

        print("== invalid severity -> 422 ==")
        resp = client.get("/api/v1/alarms", params={"severity": "NOT_REAL"})
        print(resp.status_code, resp.json())

        print("== hammering the rate limiter ==")
        for i in range(1, 26):
            resp = client.get("/health")
            marker = f" retry-after={resp.headers['retry-after']}" if resp.status_code == 429 else ""
            print(f"  req {i}: {resp.status_code}{marker}")


if __name__ == "__main__":
    main()
