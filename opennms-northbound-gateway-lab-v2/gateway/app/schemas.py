"""
Pydantic response models.

These aren't strictly required - FastAPI will happily return raw
dicts - but attaching `response_model=` in routes.py gets you three
things for free: (1) a documented, validated response shape in the
generated OpenAPI 3.0.1 spec, (2) automatic filtering of any extra
fields OpenNMS's response contains, and (3) a 500 instead of a silent
schema drift if the upstream shape changes underneath you.
"""
from pydantic import BaseModel, ConfigDict


class HealthOut(BaseModel):
    status: str
    backend: str


class NodeOut(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int | str
    label: str | None = None
    sysObjectId: str | None = None


class ErrorOut(BaseModel):
    detail: str
