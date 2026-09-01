"""
A minimal, dependency-free BER decoder for SNMPv1/v2c trap PDUs.

This is deliberately not a full SNMP stack (no MIB resolution, no v3,
no request/response) - just enough ASN.1/BER parsing to unpack what
OpenNMS's SNMP Trap Northbounder actually sends: version, community,
and the varbind list, with OIDs left as dotted-decimal strings rather
than resolved to MIB names. That's enough to prove the northbounder
fired and see exactly what it sent - which is the point of this
receiver.

Written and tested against real packets from net-snmp's `snmptrap`
command (see GUIDE.md Part 12), not reverse-engineered from
documentation alone.
"""
from dataclasses import dataclass, field

# --- BER primitives -------------------------------------------------

def _read_length(data: bytes, offset: int) -> tuple[int, int]:
    """Returns (length, new_offset). Handles short and long form."""
    first = data[offset]
    offset += 1
    if first & 0x80 == 0:
        return first, offset
    num_bytes = first & 0x7F
    length = int.from_bytes(data[offset : offset + num_bytes], "big")
    return length, offset + num_bytes


def _read_tlv(data: bytes, offset: int) -> tuple[int, bytes, int]:
    """Returns (tag, value_bytes, new_offset)."""
    tag = data[offset]
    offset += 1
    length, offset = _read_length(data, offset)
    value = data[offset : offset + length]
    return tag, value, offset + length


def _decode_integer(value: bytes) -> int:
    return int.from_bytes(value, "big", signed=True) if value else 0


def _decode_oid(value: bytes) -> str:
    if not value:
        return ""
    first = value[0]
    parts = [str(first // 40), str(first % 40)]
    n = 0
    for b in value[1:]:
        n = (n << 7) | (b & 0x7F)
        if b & 0x80 == 0:
            parts.append(str(n))
            n = 0
    return ".".join(parts)


def _decode_ip(value: bytes) -> str:
    return ".".join(str(b) for b in value) if len(value) == 4 else value.hex()


# --- Public data model ------------------------------------------------

@dataclass
class Varbind:
    oid: str
    value: object
    type_name: str


@dataclass
class SnmpTrap:
    version: int          # 0 = v1, 1 = v2c
    community: str
    pdu_tag: int           # 0xA4 = v1 Trap-PDU, 0xA7 = v2c SNMPv2-Trap-PDU
    varbinds: list = field(default_factory=list)
    # v1-only fields
    enterprise_oid: str | None = None
    agent_addr: str | None = None
    generic_trap: int | None = None
    specific_trap: int | None = None

    @property
    def is_v2c(self) -> bool:
        return self.pdu_tag == 0xA7

    def summary(self) -> str:
        ver = "v2c" if self.is_v2c else "v1"
        head = f"SNMP {ver} trap from community={self.community!r}"
        if self.is_v2c:
            trap_oid = next((v.value for v in self.varbinds if v.oid == "1.3.6.1.6.3.1.1.4.1.0"), None)
            if trap_oid:
                head += f", snmpTrapOID={trap_oid}"
        else:
            head += f", enterprise={self.enterprise_oid}, generic={self.generic_trap}, specific={self.specific_trap}"
        return head


_VALUE_DECODERS = {
    0x02: ("Integer", _decode_integer),
    0x04: ("OctetString", lambda v: v.decode("utf-8", errors="replace")),
    0x05: ("Null", lambda v: None),
    0x06: ("ObjectIdentifier", _decode_oid),
    0x40: ("IpAddress", _decode_ip),
    0x41: ("Counter32", lambda v: int.from_bytes(v, "big")),
    0x42: ("Gauge32", lambda v: int.from_bytes(v, "big")),
    0x43: ("TimeTicks", lambda v: int.from_bytes(v, "big")),
    0x44: ("Opaque", lambda v: v.hex()),
    0x46: ("Counter64", lambda v: int.from_bytes(v, "big")),
}


def _decode_value(tag: int, value: bytes):
    type_name, fn = _VALUE_DECODERS.get(tag, ("Unknown0x%02x" % tag, lambda v: v.hex()))
    return type_name, fn(value)


def _decode_varbind_list(data: bytes) -> list:
    varbinds = []
    offset = 0
    while offset < len(data):
        seq_tag, seq_value, offset = _read_tlv(data, offset)  # SEQUENCE
        vb_offset = 0
        oid_tag, oid_value, vb_offset = _read_tlv(seq_value, vb_offset)
        val_tag, val_value, vb_offset = _read_tlv(seq_value, vb_offset)
        type_name, decoded = _decode_value(val_tag, val_value)
        varbinds.append(Varbind(oid=_decode_oid(oid_value), value=decoded, type_name=type_name))
    return varbinds


def decode_trap(packet: bytes) -> SnmpTrap:
    """Decode a raw UDP payload into an SnmpTrap. Raises ValueError on
    anything that isn't a recognizable SNMPv1/v2c trap message."""
    offset = 0
    msg_tag, msg_value, _ = _read_tlv(packet, offset)
    if msg_tag != 0x30:
        raise ValueError(f"not an SNMP message (expected SEQUENCE 0x30, got 0x{msg_tag:02x})")

    inner_offset = 0
    ver_tag, ver_value, inner_offset = _read_tlv(msg_value, inner_offset)
    version = _decode_integer(ver_value)

    comm_tag, comm_value, inner_offset = _read_tlv(msg_value, inner_offset)
    community = comm_value.decode("utf-8", errors="replace")

    pdu_tag, pdu_value, inner_offset = _read_tlv(msg_value, inner_offset)

    if pdu_tag == 0xA4:  # v1 Trap-PDU
        p = 0
        ent_tag, ent_value, p = _read_tlv(pdu_value, p)
        addr_tag, addr_value, p = _read_tlv(pdu_value, p)
        gen_tag, gen_value, p = _read_tlv(pdu_value, p)
        spec_tag, spec_value, p = _read_tlv(pdu_value, p)
        ts_tag, ts_value, p = _read_tlv(pdu_value, p)
        vb_tag, vb_value, p = _read_tlv(pdu_value, p)
        return SnmpTrap(
            version=version,
            community=community,
            pdu_tag=pdu_tag,
            varbinds=_decode_varbind_list(vb_value),
            enterprise_oid=_decode_oid(ent_value),
            agent_addr=_decode_ip(addr_value),
            generic_trap=_decode_integer(gen_value),
            specific_trap=_decode_integer(spec_value),
        )

    if pdu_tag == 0xA7:  # v2c SNMPv2-Trap-PDU (request-id, error-status, error-index, varbinds)
        p = 0
        _, _, p = _read_tlv(pdu_value, p)  # request-id
        _, _, p = _read_tlv(pdu_value, p)  # error-status
        _, _, p = _read_tlv(pdu_value, p)  # error-index
        vb_tag, vb_value, p = _read_tlv(pdu_value, p)
        return SnmpTrap(
            version=version,
            community=community,
            pdu_tag=pdu_tag,
            varbinds=_decode_varbind_list(vb_value),
        )

    raise ValueError(f"unsupported PDU tag 0x{pdu_tag:02x} (only v1/v2c traps - 0xA4/0xA7 - are handled)")
