# Optional customization layer over the official PostgreSQL image.
#
# The compose file defaults to pulling docker.io/library/postgres:14 directly
# with `image:` -- that's the supported, recommended path, since OpenNMS
# creates its own schema/user on first boot from the env-file credentials.
# Use this Dockerfile (switch the compose service to `build: ./database`)
# only if you need init scripts or extensions baked in.

FROM docker.io/library/postgres:14

# Example: run init SQL once, on first container start only (Postgres's
# entrypoint executes anything in this directory alphabetically, but only
# when the data directory is empty).
# COPY init-scripts/*.sql /docker-entrypoint-initdb.d/

# Slightly stronger default auth method than Postgres's historical default.
ENV POSTGRES_HOST_AUTH_METHOD=scram-sha-256
