#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
#  Cloud Codex – WSL Startup Script
#  Checks dependencies, starts Docker + MySQL, launches the app.
#
#  All Rights Reserved to Cloud City Computing, LLC 2026
#  https://cloudcitycomputing.com
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/cloudcodex"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yaml"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✔${NC} $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $*"; }
fail() { echo -e "  ${RED}✖${NC} $*"; }
info() { echo -e "  ${CYAN}→${NC} $*"; }

# ── 1. System-level dependencies ─────────────────────────────
echo -e "\n${CYAN}[1/5]${NC} Checking system dependencies…"

NEED_APT=false

# Docker
if command -v docker &>/dev/null; then
  ok "Docker CLI found"
else
  warn "Docker CLI not found – will install"
  NEED_APT=true
fi

# Docker Compose (v2 plugin preferred, falls back to standalone)
if docker compose version &>/dev/null 2>&1 || docker-compose --version &>/dev/null 2>&1; then
  ok "Docker Compose found"
else
  warn "Docker Compose not found – will install"
  NEED_APT=true
fi

# Node.js
if command -v node &>/dev/null; then
  ok "Node.js $(node -v) found"
else
  warn "Node.js not found – will install via NodeSource"
  NEED_APT=true
fi

# npm
if command -v npm &>/dev/null; then
  ok "npm $(npm -v) found"
else
  warn "npm not found – will install with Node.js"
  NEED_APT=true
fi

# MySQL client (useful for debugging; optional but nice to have)
if command -v mysql &>/dev/null; then
  ok "mysql client found"
else
  warn "mysql client not found – will install"
  NEED_APT=true
fi

if $NEED_APT; then
  echo ""
  info "Installing missing packages…"
  sudo apt-get update -qq

  # Docker
  if ! command -v docker &>/dev/null; then
    info "Installing Docker…"
    sudo apt-get install -y -qq docker.io >/dev/null
  fi

  # Docker Compose plugin
  if ! docker compose version &>/dev/null 2>&1 && ! docker-compose --version &>/dev/null 2>&1; then
    info "Installing Docker Compose plugin…"
    sudo apt-get install -y -qq docker-compose-plugin >/dev/null 2>&1 \
      || sudo apt-get install -y -qq docker-compose >/dev/null
  fi

  # Node.js (via NodeSource if not present)
  if ! command -v node &>/dev/null; then
    info "Installing Node.js 20.x…"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - >/dev/null 2>&1
    sudo apt-get install -y -qq nodejs >/dev/null
  fi

  # MySQL client
  if ! command -v mysql &>/dev/null; then
    info "Installing mysql-client…"
    sudo apt-get install -y -qq mysql-client >/dev/null 2>&1 \
      || sudo apt-get install -y -qq default-mysql-client >/dev/null
  fi

  ok "All system dependencies installed"
fi

# ── 2. Ensure current user can talk to Docker ────────────────
echo -e "\n${CYAN}[2/5]${NC} Ensuring Docker access…"

# Determine whether we need sudo for docker commands.
# In WSL the user often isn't in the docker group yet, so
# "docker info" fails with a permission error even when the daemon is up.
DOCKER_SUDO=""
if ! docker info &>/dev/null 2>&1; then
  # Check if it's a permissions issue vs daemon-not-running
  if sudo docker info &>/dev/null 2>&1; then
    info "Docker is running but requires sudo – will use sudo for docker commands"
    DOCKER_SUDO="sudo"
  else
    info "Docker daemon not running – starting it…"

    # WSL typically needs an explicit start
    if grep -qi microsoft /proc/version 2>/dev/null; then
      sudo service docker start >/dev/null 2>&1 \
        || sudo dockerd &>/dev/null &
    else
      sudo systemctl start docker 2>/dev/null \
        || sudo service docker start >/dev/null 2>&1
    fi

    # Wait up to 20 s for the daemon to be ready
    for i in {1..20}; do
      if docker info &>/dev/null 2>&1; then break; fi
      if sudo docker info &>/dev/null 2>&1; then DOCKER_SUDO="sudo"; break; fi
      sleep 1
    done
  fi
fi

if docker info &>/dev/null 2>&1 || $DOCKER_SUDO docker info &>/dev/null 2>&1; then
  ok "Docker daemon is running"
else
  fail "Could not start Docker daemon. Try: sudo service docker start"
  exit 1
fi

# Make sure our user is in the docker group so future runs don't need sudo
if ! groups | grep -q '\bdocker\b'; then
  info "Adding $(whoami) to the docker group (takes effect on next login)…"
  sudo usermod -aG docker "$(whoami)" 2>/dev/null || true
  if [ -z "$DOCKER_SUDO" ]; then
    DOCKER_SUDO="sudo"
  fi
fi

# ── 3. Docker Compose – bring the database up ────────────────
echo -e "\n${CYAN}[3/5]${NC} Starting Docker Compose services…"

# Load credentials from .env before compose needs them for interpolation
ENV_FILE="$SCRIPT_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  fail ".env file not found. Copy .env.example to .env and fill in your credentials."
  exit 1
fi
set -a; source "$ENV_FILE"; set +a

COMPOSE_CMD="$DOCKER_SUDO docker compose"
if ! $COMPOSE_CMD version &>/dev/null 2>&1; then
  COMPOSE_CMD="$DOCKER_SUDO docker-compose"
fi

cd "$SCRIPT_DIR"

# Pull image if missing
if ! $DOCKER_SUDO docker image inspect mysql:8 &>/dev/null 2>&1; then
  info "Pulling mysql:8 image (first run)…"
  $COMPOSE_CMD pull
fi

$COMPOSE_CMD up -d 2>&1 | while IFS= read -r line; do info "$line"; done
ok "Compose services started"

# ── 4. Wait for MySQL to accept connections ───────────────────
echo -e "\n${CYAN}[4/5]${NC} Waiting for MySQL to be ready…"

DB_USER="${DB_USER:?DB_USER not set in .env}"
DB_PASS="${DB_PASS:?DB_PASS not set in .env}"
DB_NAME="${DB_NAME:-c2}"
MAX_WAIT=60
WAITED=0

while ! $DOCKER_SUDO docker exec "$(${COMPOSE_CMD} ps -q database)" \
        mysqladmin ping -u"$DB_USER" -p"$DB_PASS" --silent 2>/dev/null; do
  if (( WAITED >= MAX_WAIT )); then
    fail "MySQL did not become ready within ${MAX_WAIT}s"
    info "Check logs: $COMPOSE_CMD logs database"
    exit 1
  fi
  sleep 2
  WAITED=$((WAITED + 2))
done
ok "MySQL is accepting connections (waited ${WAITED}s)"

# Quick sanity check: can we query the c2 database?
if $DOCKER_SUDO docker exec "$(${COMPOSE_CMD} ps -q database)" \
     mysql -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "SELECT 1" &>/dev/null; then
  ok "Database '$DB_NAME' is accessible"
else
  warn "Database '$DB_NAME' not accessible – container may need init.sql to run."
  info "If this is the first start, the entrypoint script will create it automatically."
fi

# Verify the host can reach MySQL on the mapped port (how the Node app connects)
if mysql -u"$DB_USER" -p"$DB_PASS" -h 127.0.0.1 -P 3306 "$DB_NAME" -e "SELECT 1" &>/dev/null 2>&1; then
  ok "Host can reach MySQL on 127.0.0.1:3306"
else
  warn "Host mysql client can't reach 127.0.0.1:3306 – the Node app uses the Docker-mapped port."
  info "This is usually fine if you don't have a local mysql-client, the app will connect via the driver."
fi

# ── 5. Install npm deps & start the Node app ─────────────────
echo -e "\n${CYAN}[5/5]${NC} Starting the Cloud Codex app…"

cd "$APP_DIR"

if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules/.package-lock.json" ] 2>/dev/null; then
  info "Installing npm dependencies…"
  npm install --no-audit --no-fund 2>&1 | tail -1
  ok "npm packages installed"
else
  ok "npm packages up to date"
fi

echo ""
echo -e "${GREEN}────────────────────────────────────────${NC}"
echo -e "${GREEN}  Cloud Codex is starting on port 3000  ${NC}"
echo -e "${GREEN}────────────────────────────────────────${NC}"
echo ""

exec npm run dev
