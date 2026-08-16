# Optional customization layer over the official OpenNMS Horizon image.
#
# The compose file defaults to pulling docker.io/opennms/horizon:latest
# directly with `image:` -- that's the supported, recommended path. Use this
# Dockerfile (switch the compose service to `build: ./opennms`) only if you
# need to bake something into the image itself, e.g. debugging tools or a
# pre-baked custom event file instead of a bind-mounted etc-overlay.

FROM docker.io/opennms/horizon:latest

# Example: install extra debugging tools inside the container.
# Uncomment if useful for tracing (Part 6 of the step-by-step guide) without
# needing to `podman exec` a separate debug container.
# USER root
# RUN apt-get update \
#     && apt-get install -y --no-install-recommends tcpdump iputils-ping \
#     && rm -rf /var/lib/apt/lists/*

# Example: bake the custom event file into the image instead of relying on
# the etc-overlay bind mount at runtime.
# COPY ../etc-overlay/events/custom.events.xml /opt/opennms/etc/events/custom.events.xml

# Matches the official image's expected entrypoint mode ("start" -- init DB
# if needed, apply config, start Horizon).
CMD ["-s"]
