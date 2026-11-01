# =============================================================================
# Base image selection (Sprint 6 F07)
# =============================================================================
# The three build stages pin the Node.js base image by content digest
# rather than by floating tag so the image we actually ship is
# reproducible and cannot be swapped out from under us by a registry
# update to the node:24-alpine tag. The digest below is the multi-arch
# index digest of node:24-alpine, resolved 2026-10-22. To refresh it, run
# `docker buildx imagetools inspect node:24-alpine` and paste the
# "Digest:" value into NODE_IMAGE below. (Security review W7: the pin was
# documented here but the ARG used the floating tag.) Operators who
# want additional assurance should verify the image with cosign
# before tagging a release:
#
#   cosign verify \
#     --certificate-identity-regexp 'https://github.com/docker-library/official-images' \
#     --certificate-oidc-issuer https://token.actions.githubusercontent.com \
#     node@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
#
# See docs/ for the full supply chain guidance.
# =============================================================================
ARG NODE_IMAGE=node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53

# Stage 1: Build frontend
FROM ${NODE_IMAGE} AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
# Build stages skip install scripts: they only compile and bundle, and
# CI builds the same way (security review W7).
RUN npm ci --ignore-scripts
COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend
FROM ${NODE_IMAGE} AS backend-build
WORKDIR /app/backend
COPY backend/package*.json ./
# TypeScript compile only: no native modules are built here (argon2 is
# rebuilt in the backend-deps stage).
RUN npm ci --ignore-scripts
COPY backend/ ./
RUN npm run build

# Stage 3: Production dependencies. argon2 is a native module: it is
# compiled here with build tools that never reach the shipped image (a
# later `apk del` cannot remove what an earlier layer added; container-hardening
# image review 2026-10-27: 286 MB of compilers shipped that way).
FROM ${NODE_IMAGE} AS backend-deps
WORKDIR /app/backend
COPY backend/package*.json ./
RUN apk add --no-cache python3 make g++ \
    && npm ci --omit=dev --ignore-scripts \
    && npm rebuild argon2

# Stage 4: Production image (backend serves the API on /api and the
# compiled Vue 3 single-page application on /).
FROM ${NODE_IMAGE} AS production

# The app never runs a package manager. npm, npx, corepack and yarn come
# with the base image and carried every remaining CVE in it (npm's own
# bundled undici, brace-expansion, ip-address, http-cache-semantics);
# removing them also leaves an intruder no installer.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
    && addgroup -g 1001 -S appgroup \
    && adduser -S appuser -u 1001 -G appgroup \
    && mkdir -p /app/data \
    && chown appuser:appgroup /app/data

WORKDIR /app

# Code and dependencies stay owned by root: the app user can read and
# run them but not change them. Only /app/data (PGlite) is writable.
# (A recursive chown also duplicated all of /app into a 140 MB layer.)
COPY --from=backend-deps /app/backend/node_modules ./backend/node_modules
COPY backend/package.json ./backend/package.json

# Copy compiled backend
COPY --from=backend-build /app/backend/dist ./backend/dist

# Copy frontend bundle. The backend detects this directory at startup
# and serves its contents plus a SPA fallback. When the directory is
# absent the backend runs in API-only mode.
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

USER appuser

# Environment defaults (override at runtime)
#
# CORS_ORIGIN is intentionally NOT set in the image. The backend
# falls back to http://localhost:5173 when unset, and the packaged
# deployment serves the SPA and the API on the same origin, so CORS
# is a no op in that case. Operators exposing the API to a different
# origin must set CORS_ORIGIN to the concrete allowed origin. A
# wildcard default here would expose every deployment to cross origin
# attacks from any site a user happens to visit.
ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_PROVIDER=pglite
ENV PGLITE_DATA_DIR=/app/data/pglite

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

CMD ["node", "backend/dist/index.js"]
