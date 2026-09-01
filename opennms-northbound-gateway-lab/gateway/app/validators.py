"""
Request-validation rules shared by both protocol adapters (REST in
routes.py, gRPC in grpc_app/servicer.py).

Splitting validation out like this is the point being demonstrated:
FastAPI's Pydantic layer and protobuf's typed fields both give you
*type* validation for free, but neither knows your *business* rules
(valid severities, sane limits, positive node IDs). Those rules belong
in one place so REST and gRPC clients get identical behavior.
"""

VALID_SEVERITIES = {
    "CLEARED",
    "INDETERMINATE",
    "NORMAL",
    "WARNING",
    "MINOR",
    "MAJOR",
    "CRITICAL",
}


class ValidationError(ValueError):
    """Raised on a failed business-rule check. Callers translate this
    into an HTTP 422 (REST) or INVALID_ARGUMENT (gRPC)."""


def validate_node_id(node_id: int) -> int:
    if node_id <= 0:
        raise ValidationError(f"node_id must be a positive integer, got {node_id}")
    return node_id


def validate_severity(severity: str | None) -> str | None:
    if severity is None or severity == "":
        return None
    normalized = severity.strip().upper()
    if normalized not in VALID_SEVERITIES:
        raise ValidationError(
            f"severity must be one of {sorted(VALID_SEVERITIES)}, got {severity!r}"
        )
    return normalized


def validate_limit(limit: int, max_limit: int = 200) -> int:
    if not (1 <= limit <= max_limit):
        raise ValidationError(f"limit must be between 1 and {max_limit}, got {limit}")
    return limit
