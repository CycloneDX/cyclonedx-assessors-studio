---
title: Deployment
description: Install Assessors Studio in Docker for evaluation or production, with PGlite or external PostgreSQL.
---

Assessors Studio is distributed as a single container image that serves both the Vue 3 single-page application and the JSON API on the same origin. This page covers the three supported deployment topologies: a quick-start evaluation install, a production install against PostgreSQL, and a reverse-proxy fronted deployment with TLS.

The Compose files build the image from the repository by default (`cyclonedx-assessors-studio:local`). CI publishes this fork's image to GitHub Container Registry at `ghcr.io/<owner>/cyclonedx-assessors-studio`: `snapshot` from the main branch, versioned tags from GitHub releases, and `latest` for the most recent non-prerelease. Each published image carries build provenance and an SBOM. To run a published image, set `APP_IMAGE` (pinned by digest) and `APP_PULL_POLICY=always`.

## Quick start with PGlite

PGlite is an embedded PostgreSQL implementation that lives inside the container. It is ideal for evaluation, single-operator use, and small installations that do not need an external database.

Download the evaluation Compose file:

```bash
curl -O https://raw.githubusercontent.com/CycloneDX/cyclonedx-assessors-studio/main/deploy/docker/docker-compose.yml
```

Start the stack:

```bash
docker compose up -d
```

The application is available at `http://localhost:3001`. The first request is redirected to the setup wizard, where you create the initial administrator account. See [First Login](/getting-started/first-login/) for the wizard walkthrough.

The Compose file defines a single `app` service and an `app-data` named volume that holds the embedded database. No environment variables are required; the backend generates a JWT signing secret on first run and persists it alongside the rest of the application state.

To override settings, create a `.env` file next to the Compose file or pass variables on the command line:

```bash
APP_PORT=8080 JWT_SECRET=... docker compose up -d
```

The full list of variables is in the [Environment Variables](/configuration/environment-variables/) reference. The most common override in an evaluation install is `APP_PORT` to publish on something other than 3001.

## Production with PostgreSQL

Production installations should use an external PostgreSQL 17 database. The production Compose file runs a `db` service and an `app` service, with the app depending on the database's health check.

Download the production Compose file:

```bash
curl -O https://raw.githubusercontent.com/CycloneDX/cyclonedx-assessors-studio/main/deploy/docker/docker-compose.production.yml
```

Every credential is a Docker Compose secret, a file mounted at `/run/secrets/<name>`, never an environment variable, so none of them appears in `docker inspect` output or the process environment. Create the files once, next to the Compose file:

```bash
./init-secrets.sh
docker compose -f docker-compose.production.yml up -d --build
```

`init-secrets.sh` generates the database password, the encryption key, the JWT secret and the one-time setup token, and creates empty files for the optional SMTP, metrics and S3 credentials (fill them in when you enable those features). It never overwrites an existing file. The stack does not start while any secret file is missing.

The setup wizard asks for the token in `secrets/setup_token`. Keep a copy of `secrets/master_encryption_key` somewhere safe and separate from your backups: without it, encrypted data cannot be read.

On Docker Desktop for macOS, keep the deployment directory outside `~/Documents`, `~/Desktop` and `~/Downloads`; macOS privacy settings stop Docker from mounting files from those folders.

If you manage the database outside of Docker (managed PostgreSQL service), remove the `db` service from the Compose file and point `DATABASE_URL` at your instance. Every setting driven by `DATABASE_URL` is documented on the [Environment Variables](/configuration/environment-variables/) page.

## Behind a reverse proxy

Assessors Studio does not terminate TLS. For production you should place a reverse proxy in front of the container. The repository ships a Caddy overlay that obtains and renews a certificate automatically:

```bash
SITE_ADDRESS=hub.example.com docker compose \
  -f docker-compose.production.yml -f docker-compose.proxy.yml up -d
```

The production file sets `TRUST_PROXY_HOPS=1`, which is correct for one proxy. Any other proxy works too: nginx, Traefik, HAProxy, a cloud load balancer. The proxy responsibilities are:

- Terminate TLS on port 443 with a valid certificate.
- Forward decrypted traffic to the application on port 3001.
- Set standard proxy headers (`X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host`).

Example with Caddy:

```txt
studio.example.com {
  reverse_proxy app:3001
}
```

Example with nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name studio.example.com;
  ssl_certificate     /etc/ssl/fullchain.pem;
  ssl_certificate_key /etc/ssl/privkey.pem;

  location / {
    proxy_pass         http://app:3001;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_set_header   X-Forwarded-Host  $host;
  }
}
```

Set `APP_URL` and `CORS_ORIGIN` on the application to the public URL so notification links and API call origins are correct:

```
APP_URL=https://studio.example.com
CORS_ORIGIN=https://studio.example.com
```

## Running without Docker Compose

The image can be run directly with `docker run` or deployed via any container orchestrator (Kubernetes, Nomad, ECS). The runtime requirements are:

- Port 3001 reachable inside the cluster.
- A writable data volume mounted at `/app/data` if PGlite is in use, or network access to PostgreSQL if the external provider is configured.
- Access to the configured evidence storage (the database itself or an S3-compatible endpoint).
- Outbound access to any configured notification endpoints.

The [Environment Variables](/configuration/environment-variables/) reference lists every setting that controls runtime behavior.

## Verifying the install

Check the health endpoint:

```bash
curl http://localhost:3001/api/health
```

A healthy instance returns `{"status":"healthy", ...}`. The `/metrics` endpoint (when `METRICS_ENABLED=true`) exposes Prometheus metrics. Application logs stream to stdout in JSON format; capture them with your usual container log pipeline.

## What to do next

After the container is healthy:

1. Complete the setup wizard ([First Login](/getting-started/first-login/)).
2. Invite co-administrators ([Users and Permissions](/administration/users-and-permissions/)).
3. Configure the notification channels your organization uses ([Integrations](/administration/integrations/)).
4. Decide on storage for evidence ([Evidence Storage](/administration/storage/)).
5. Enable encryption at rest if applicable ([Encryption at Rest](/administration/encryption-at-rest/)).
6. Plan your first backup schedule ([Backup and Recovery](/administration/backup-and-recovery/)). `deploy/docker/backup.sh` and `restore.sh` cover the Compose deployment; rehearse a restore into a scratch deployment periodically.
