"""
Central, env-driven configuration for the Northbound Gateway.

Every value has a sane default so the gateway runs out of the box, but
in a real deployment you'd set these via .env / podman-compose env_file.
"""
import os
from dataclasses import dataclass, field


def _split_csv(value: str) -> list[str]:
    return [v.strip() for v in value.split(",") if v.strip()]


@dataclass
class Settings:
    # --- Upstream OpenNMS (the "system of record" this gateway fronts) ---
    opennms_base_url: str = os.getenv("OPENNMS_BASE_URL", "http://192.168.1.122:8980")
    opennms_user: str = os.getenv("OPENNMS_USER", "admin")
    opennms_password: str = os.getenv("OPENNMS_PASSWORD", "admin")
    opennms_timeout_seconds: float = float(os.getenv("OPENNMS_TIMEOUT_SECONDS", "5.0"))

    # --- Gateway-facing auth (clients talk to the gateway with an API key;
    #     the gateway talks to OpenNMS with the Basic auth creds above -
    #     that split is the point of a gateway: it doesn't just forward
    #     credentials, it translates between two different trust zones) ---
    api_keys: list[str] = field(
        default_factory=lambda: _split_csv(os.getenv("GATEWAY_API_KEYS", "demo-key-123"))
    )

    # --- Rate limiting: N requests per rolling window, per API key ---
    rate_limit_requests: int = int(os.getenv("RATE_LIMIT_REQUESTS", "20"))
    rate_limit_window_seconds: float = float(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))

    # --- Ports ---
    rest_port: int = int(os.getenv("REST_PORT", "8000"))
    grpc_port: int = int(os.getenv("GRPC_PORT", "50051"))

    # --- Misc ---
    max_list_limit: int = int(os.getenv("MAX_LIST_LIMIT", "200"))


settings = Settings()
