"""
Minimal SNMP trap receiver - stands in for the "overarching central
manager" / Manager-of-Managers that OpenNMS's SNMP Trap Northbounder
forwards alarms to.

Listens on UDP (default 1162 - see the note on port 162 in
GUIDE.md Part 12) and logs each decoded trap. Not a replacement for
net-snmp's `snmptrapd` in production - this exists so you can see
exactly what's inside the packets the northbounder sends, in plain
Python you can step through.
"""
import logging
import os
import socketserver

from decoder import decode_trap

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
logger = logging.getLogger("snmptrap-receiver")

HOST = os.getenv("LISTEN_HOST", "0.0.0.0")
PORT = int(os.getenv("LISTEN_PORT", "1162"))


class TrapHandler(socketserver.BaseRequestHandler):
    def handle(self):
        packet, sock = self.request
        try:
            trap = decode_trap(packet)
        except Exception as e:
            logger.warning("received %d bytes from %s that didn't decode as a trap: %s",
                            len(packet), self.client_address, e)
            return

        logger.info("from %s: %s", self.client_address, trap.summary())
        for vb in trap.varbinds:
            logger.info("    %s (%s) = %r", vb.oid, vb.type_name, vb.value)


class ThreadingUDPServer(socketserver.ThreadingMixIn, socketserver.UDPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    logger.info("SNMP trap receiver listening on %s:%s/udp", HOST, PORT)
    server = ThreadingUDPServer((HOST, PORT), TrapHandler)
    server.serve_forever()
