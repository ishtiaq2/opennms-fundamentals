from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class HealthCheckRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class HealthCheckResponse(_message.Message):
    __slots__ = ("status", "backend")
    STATUS_FIELD_NUMBER: _ClassVar[int]
    BACKEND_FIELD_NUMBER: _ClassVar[int]
    status: str
    backend: str
    def __init__(self, status: _Optional[str] = ..., backend: _Optional[str] = ...) -> None: ...

class GetNodeRequest(_message.Message):
    __slots__ = ("node_id",)
    NODE_ID_FIELD_NUMBER: _ClassVar[int]
    node_id: int
    def __init__(self, node_id: _Optional[int] = ...) -> None: ...

class NodeResponse(_message.Message):
    __slots__ = ("node_id", "label", "sys_object_id", "provisioned")
    NODE_ID_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    SYS_OBJECT_ID_FIELD_NUMBER: _ClassVar[int]
    PROVISIONED_FIELD_NUMBER: _ClassVar[int]
    node_id: int
    label: str
    sys_object_id: str
    provisioned: bool
    def __init__(self, node_id: _Optional[int] = ..., label: _Optional[str] = ..., sys_object_id: _Optional[str] = ..., provisioned: _Optional[bool] = ...) -> None: ...

class ListNodesRequest(_message.Message):
    __slots__ = ("limit", "offset")
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    OFFSET_FIELD_NUMBER: _ClassVar[int]
    limit: int
    offset: int
    def __init__(self, limit: _Optional[int] = ..., offset: _Optional[int] = ...) -> None: ...

class ListNodesResponse(_message.Message):
    __slots__ = ("nodes", "total")
    NODES_FIELD_NUMBER: _ClassVar[int]
    TOTAL_FIELD_NUMBER: _ClassVar[int]
    nodes: _containers.RepeatedCompositeFieldContainer[NodeResponse]
    total: int
    def __init__(self, nodes: _Optional[_Iterable[_Union[NodeResponse, _Mapping]]] = ..., total: _Optional[int] = ...) -> None: ...

class ListAlarmsRequest(_message.Message):
    __slots__ = ("severity", "limit")
    SEVERITY_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    severity: str
    limit: int
    def __init__(self, severity: _Optional[str] = ..., limit: _Optional[int] = ...) -> None: ...

class Alarm(_message.Message):
    __slots__ = ("alarm_id", "uei", "severity", "log_msg", "node_id")
    ALARM_ID_FIELD_NUMBER: _ClassVar[int]
    UEI_FIELD_NUMBER: _ClassVar[int]
    SEVERITY_FIELD_NUMBER: _ClassVar[int]
    LOG_MSG_FIELD_NUMBER: _ClassVar[int]
    NODE_ID_FIELD_NUMBER: _ClassVar[int]
    alarm_id: int
    uei: str
    severity: str
    log_msg: str
    node_id: int
    def __init__(self, alarm_id: _Optional[int] = ..., uei: _Optional[str] = ..., severity: _Optional[str] = ..., log_msg: _Optional[str] = ..., node_id: _Optional[int] = ...) -> None: ...

class ListAlarmsResponse(_message.Message):
    __slots__ = ("alarms",)
    ALARMS_FIELD_NUMBER: _ClassVar[int]
    alarms: _containers.RepeatedCompositeFieldContainer[Alarm]
    def __init__(self, alarms: _Optional[_Iterable[_Union[Alarm, _Mapping]]] = ...) -> None: ...

class StreamEventsRequest(_message.Message):
    __slots__ = ("poll_interval_seconds",)
    POLL_INTERVAL_SECONDS_FIELD_NUMBER: _ClassVar[int]
    poll_interval_seconds: int
    def __init__(self, poll_interval_seconds: _Optional[int] = ...) -> None: ...

class EventMessage(_message.Message):
    __slots__ = ("event_id", "uei", "description", "timestamp")
    EVENT_ID_FIELD_NUMBER: _ClassVar[int]
    UEI_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    event_id: int
    uei: str
    description: str
    timestamp: str
    def __init__(self, event_id: _Optional[int] = ..., uei: _Optional[str] = ..., description: _Optional[str] = ..., timestamp: _Optional[str] = ...) -> None: ...
