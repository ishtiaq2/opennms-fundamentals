from fastapi import APIRouter, Depends, HTTPException

from .auth import require_api_key
from .opennms_client import opennms_client
from .schemas import HealthOut, NodeOut
from .validators import ValidationError, validate_limit, validate_node_id, validate_severity

router = APIRouter()


@router.get("/health", response_model=HealthOut, tags=["gateway"])
async def health():
    """Gateway + upstream OpenNMS reachability. Not API-key protected -
    used for container/orchestrator health checks."""
    return await opennms_client.health()


@router.get("/api/v1/nodes/{node_id}", response_model=NodeOut, tags=["nodes"])
async def get_node(node_id: int, _key: str = Depends(require_api_key)):
    try:
        node_id = validate_node_id(node_id)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=str(e))

    try:
        return await opennms_client.get_node(node_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenNMS lookup failed: {e}")


@router.get("/api/v1/nodes", tags=["nodes"])
async def list_nodes(limit: int = 20, offset: int = 0, _key: str = Depends(require_api_key)):
    try:
        limit = validate_limit(limit)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=str(e))

    try:
        return await opennms_client.list_nodes(limit=limit, offset=offset)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenNMS lookup failed: {e}")


@router.get("/api/v1/alarms", tags=["alarms"])
async def list_alarms(
    severity: str | None = None, limit: int = 20, _key: str = Depends(require_api_key)
):
    try:
        severity = validate_severity(severity)
        limit = validate_limit(limit)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=str(e))

    try:
        return await opennms_client.list_alarms(severity=severity, limit=limit)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenNMS lookup failed: {e}")


@router.get("/api/v1/events", tags=["events"])
async def list_events(limit: int = 20, _key: str = Depends(require_api_key)):
    try:
        limit = validate_limit(limit)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=str(e))

    try:
        return await opennms_client.list_events(limit=limit)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenNMS lookup failed: {e}")


@router.get("/api/v1/northbound/{subpath:path}", tags=["northbound-plugin"])
async def call_northbound_plugin(subpath: str = "", _key: str = Depends(require_api_key)):
    """Proxies to your existing custom Northbound REST plugin
    (/opennms/rest/northbound/...) - one gateway, more than one
    upstream surface behind it."""
    try:
        return await opennms_client.call_northbound_plugin(subpath)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Northbound plugin call failed: {e}")
