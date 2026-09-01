"""
Thin async wrapper around OpenNMS's own ReST API.

This is the *only* module that knows OpenNMS's URLs, auth, and JSON
shapes. Everything above it (REST routes, gRPC servicer) talks to this
client, not to httpx directly - so if you're pointing at a different
OpenNMS version with slightly different field names, this is the one
file you should need to touch.

Field names below (label, sysObjectId, logMsg, totalCount, ...) match
OpenNMS's V1 ReST API as of recent Horizon releases. If your instance
returns different shapes, adjust the `.get(...)` calls here - run a
`curl` against your own instance first (GUIDE.md Part 4) and compare.
"""
import httpx

from .config import settings


class OpenNMSClient:
    def __init__(self):
        self._auth = (settings.opennms_user, settings.opennms_password)
        self._base_url = settings.opennms_base_url.rstrip("/")
        self._timeout = settings.opennms_timeout_seconds

    async def _get(self, path: str, params: dict | None = None) -> httpx.Response:
        url = f"{self._base_url}{path}"
        async with httpx.AsyncClient(auth=self._auth, timeout=self._timeout) as client:
            return await client.get(url, params=params, headers={"Accept": "application/json"})

    async def health(self) -> dict:
        try:
            resp = await self._get("/opennms/rest/info")
            resp.raise_for_status()
            return {"status": "ok", "backend": self._base_url}
        except httpx.HTTPError as exc:
            return {"status": "unreachable", "backend": self._base_url, "detail": str(exc)}

    async def get_node(self, node_id: int) -> dict:
        resp = await self._get(f"/opennms/rest/nodes/{node_id}")
        resp.raise_for_status()
        return resp.json()

    async def list_nodes(self, limit: int = 20, offset: int = 0) -> dict:
        resp = await self._get("/opennms/rest/nodes", params={"limit": limit, "offset": offset})
        resp.raise_for_status()
        return resp.json()

    async def list_alarms(self, severity: str | None = None, limit: int = 20) -> dict:
        params: dict = {"limit": limit}
        if severity:
            params["comparator"] = "EQ"
            params["severity"] = severity
        resp = await self._get("/opennms/rest/alarms", params=params)
        resp.raise_for_status()
        return resp.json()

    async def list_events(self, limit: int = 20) -> dict:
        resp = await self._get("/opennms/rest/events", params={"limit": limit})
        resp.raise_for_status()
        return resp.json()

    async def call_northbound_plugin(self, subpath: str = "") -> dict:
        """
        Calls your existing custom Northbound REST plugin
        (/opennms/rest/northbound/...) instead of core OpenNMS ReST -
        demonstrating that a gateway can front more than one upstream
        surface behind a single, consistent external API.
        """
        path = f"/opennms/rest/northbound/{subpath}".rstrip("/")
        resp = await self._get(path)
        resp.raise_for_status()
        return resp.json()


opennms_client = OpenNMSClient()
