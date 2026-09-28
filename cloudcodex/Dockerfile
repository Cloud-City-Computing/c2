# Cloud Codex production image.
#
# Two stages so the published image carries the built frontend and the
# production dependency tree, but not the toolchain that produced them.
# The single-stage version of this file produced a 2.86 GB image: the full
# node:20 base, devDependencies that are only needed to run Vite and Vitest,
# and, because there was no .dockerignore, a second copy of node_modules
# carried in from the host.

# ---- build stage: full dependency tree, produces dist/ ----
FROM node:20-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- runtime stage: production dependencies plus the built assets ----
FROM node:20-slim

# vite-express switches to serving the prebuilt dist/ instead of booting a Vite
# dev server off this, so it has to be set before server.js is imported, not
# just passed to `npm run start`.
ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Backend source. src/ comes along whole rather than being dropped in favour of
# dist/, because the server imports src/lib/githubDiff.js directly.
COPY . .

# The frontend build, from the stage that had the toolchain to make it.
COPY --from=build /app/dist ./dist

# Documentation only; the app binds PORT (default 3000) and Compose publishes
# whatever PORT is set to. Changing this line does not move the bound port.
EXPOSE 3000

# Readiness, not just liveness: /readyz answers 503 until the instance lock is
# held, MySQL answers and every file in /migrations is applied, and from the
# moment a stop signal arrives (routes/health.js). node:20-slim ships no curl
# or wget, so the probe is Node's own fetch, on whatever PORT the app binds.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/readyz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# Node as the process, not npm: `docker stop` sends SIGTERM to the container's
# main process, and with npm in between it reached npm, Node never ran its
# shutdown, and the last three seconds of collaborative edits were lost to the
# SIGKILL that followed. NODE_ENV=production comes from the ENV above, which is
# why the start script's own prefix is not needed here.
CMD ["node", "server.js"]
