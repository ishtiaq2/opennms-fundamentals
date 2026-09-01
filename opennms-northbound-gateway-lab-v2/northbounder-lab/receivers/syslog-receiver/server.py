"""
Minimal syslog receiver - stands in for whatever external log
aggregator (Splunk, an rsyslog relay, ...) OpenNMS's Syslog
Northbounder forwards alarms to.

Matches the northbounder's default output: BSD-style syslog
(RFC 3164-ish) over UDP, PRI header + timestamp + hostname + message.
See northbounder-lab/opennms-northbound-configs/syslog-northbounder-configuration.xml
for the <message-format> that controls what ends up in the text.
"""
import logging
import os
import re
import socketserver

logging.basicConfig(level=logging.INFO, format="%(asctime)s RECEIVER: %(message)s")
logger = logging.getLogger("syslog-receiver")

HOST = os.getenv("LISTEN_HOST", "0.0.0.0")
PORT = int(os.getenv("LISTEN_PORT", "5140"))

_FACILITIES = [
    "kern", "user", "mail", "daemon", "auth", "syslog", "lpr", "news",
    "uucp", "cron", "authpriv", "ftp", "ntp", "audit", "alert", "clock",
    "local0", "local1", "local2", "local3", "local4", "local5", "local6", "local7",
]
_SEVERITIES = ["emerg", "alert", "crit", "err", "warning", "notice", "info", "debug"]

_PRI_RE = re.compile(rb"^<(\d+)>(.*)", re.DOTALL)


def parse_syslog(packet: bytes) -> dict:
    m = _PRI_RE.match(packet)
    if not m:
        return {"raw": packet.decode("utf-8", errors="replace")}

    pri = int(m.group(1))
    facility_num, severity_num = divmod(pri, 8)
    facility = _FACILITIES[facility_num] if facility_num < len(_FACILITIES) else f"facility{facility_num}"
    severity = _SEVERITIES[severity_num] if severity_num < len(_SEVERITIES) else f"sev{severity_num}"

    rest = m.group(2).decode("utf-8", errors="replace")
    # RFC 3164: "<PRI>Mon dd hh:mm:ss hostname message..."
    # OpenNMS's northbounder sends local time + local hostname by default
    # (send-local-time / send-local-name in the config) - be lenient
    # rather than strict about the exact timestamp format.
    timestamp_re = re.match(r"^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(.*)$", rest)
    if timestamp_re:
        timestamp, hostname, message = timestamp_re.groups()
    else:
        timestamp, hostname, message = None, None, rest.strip()

    return {
        "facility": facility,
        "severity": severity,
        "timestamp": timestamp,
        "hostname": hostname,
        "message": message,
    }


class SyslogHandler(socketserver.BaseRequestHandler):
    def handle(self):
        packet, sock = self.request
        parsed = parse_syslog(packet)
        if "raw" in parsed:
            logger.warning("unparsed message from %s: %r", self.client_address, parsed["raw"])
            return
        logger.info(
            "from %s [%s.%s] host=%s: %s",
            self.client_address, parsed["facility"], parsed["severity"],
            parsed["hostname"], parsed["message"],
        )


class ThreadingUDPServer(socketserver.ThreadingMixIn, socketserver.UDPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    logger.info("Syslog receiver listening on %s:%s/udp", HOST, PORT)
    server = ThreadingUDPServer((HOST, PORT), SyslogHandler)
    server.serve_forever()
