# shellcheck shell=bash
# shellcheck disable=SC2034  # the constants are read by the scripts that source this file
#
# Shared by scripts/backup.sh and scripts/restore.sh: how to reach one Cloud
# Codex instance's database and uploads, and what the archive holds.
#
# All Rights Reserved to Cloud City Computing, LLC 2026
# https://cloudcitycomputing.com
#
# Two transports reach the same two things.
#
#   Compose (the default)  `docker compose` with COMPOSE_FILE (default:
#                          docker-compose-release.yml at the repository root).
#                          MySQL is reached inside the `database` service, as
#                          the MYSQL_USER that service was created with, which
#                          the image grants everything on MYSQL_DATABASE and
#                          nothing else. The uploads are /app/public in a
#                          one-off `app` container, the app_public volume.
#   --local                the mysql and mysqldump clients on PATH, over TCP,
#                          as DB_USER with DB_PASS at DB_HOST, on DB_NAME (the
#                          app's own variables), and the uploads directory on
#                          disk (--uploads, default cloudcodex/public).
#
# Neither transport uses the MySQL root account, and no password is ever on a
# command line: the clients read MYSQL_PWD from their own environment.
#
# Inside the database service the clients connect over TCP to 127.0.0.1, not
# the socket. The first time a data directory starts, the image runs init.sql
# on a temporary server that listens on the socket alone, and a socket
# healthcheck (the compose files' before this change) passes against it; a
# restore that reached it would race init.sql, and the temporary server stops
# under it. Over TCP only the real server answers.
#
# The archive is a gzipped tar of exactly three members:
#   database.sql       mysqldump of the one schema, schema_migrations included
#   app_public.tar.gz  the uploads directory (avatars/, doc-images/)
#   manifest.json      format, created_at, database, app_version and the
#                      SHA-256 of the other two; no host, user or secret

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly REPO_ROOT
readonly ARCHIVE_FORMAT=1
readonly ARCHIVE_MEMBERS='app_public.tar.gz
database.sql
manifest.json'

# The name cloudcodex/services/instance-lock.js takes its lock under
# (INSTANCE_LOCK_NAME_SQL there; keep the two identical). A restore refuses
# while anything holds it, and holds it itself while it loads.
readonly INSTANCE_LOCK_NAME_SQL="IF(CHAR_LENGTH(DATABASE()) <= 44, CONCAT('cloudcodex-instance:', DATABASE()), CONCAT('cloudcodex-instance#', LEFT(SHA2(DATABASE(), 256), 40)))"

# --single-transaction: one consistent snapshot, for InnoDB tables (every
# table init.sql creates). --hex-blob: ydoc_state and every other binary
# column byte for byte. --no-tablespaces: needs no PROCESS privilege.
readonly DUMP_FLAGS=(--single-transaction --routines --triggers --hex-blob --no-tablespaces
  --default-character-set=utf8mb4)

MODE=compose
UPLOADS_DIR=""
CLIENT_GUARD=()

die() {
  printf '%s: %s\n' "${0##*/}" "$*" >&2
  exit 1
}

say() {
  printf '%s\n' "$*" >&2
}

# The target database name: a plain identifier, never a system schema.
check_database_name() {
  local name="$1"
  [[ "$name" =~ ^[A-Za-z0-9_$-]{1,64}$ ]] ||
    die "database name '$name' is not one this script handles (letters, digits, _, \$ and -, at most 64)"
  case "$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')" in
    mysql | sys | information_schema | performance_schema)
      die "'$name' is a MySQL system schema, never a Cloud Codex database" ;;
  esac
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

compose() {
  docker compose "$@"
}

# Configure the transport once the arguments are parsed.
setup_transport() {
  if [[ "$MODE" == compose ]]; then
    command -v docker >/dev/null 2>&1 || die "docker is not on PATH (or pass --local)"
    export COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/docker-compose-release.yml}"
  else
    local tool
    for tool in mysql mysqldump; do
      command -v "$tool" >/dev/null 2>&1 || die "--local needs the $tool client on PATH"
    done
    # MariaDB's mysqldump writes the values of MySQL's generated columns
    # (logs.plain_content), and MySQL refuses every such row on restore
    # (ERROR 3105), so its dump of a Cloud Codex database cannot come back.
    if mysqldump --version | grep -qi mariadb; then
      die "--local needs MySQL's mysqldump; this one is MariaDB's, whose dumps of Cloud Codex MySQL cannot restore"
    fi
    [[ -n "${DB_USER:-}" ]] || die "--local needs DB_USER"
    [[ -n "${DB_PASS:-}" ]] || die "--local needs DB_PASS"
    DB_HOST="${DB_HOST:-localhost}"
    DB_NAME="${DB_NAME:-c2}"
    UPLOADS_DIR="${UPLOADS_DIR:-$REPO_ROOT/cloudcodex/public}"
  fi
}

# The instance's database name, from the database service's own environment
# (Compose) or DB_NAME (--local).
target_database() {
  if [[ "$MODE" == compose ]]; then
    # shellcheck disable=SC2016  # expanded by the container's shell, not this one
    compose exec -T database sh -c 'printf "%s" "$MYSQL_DATABASE"'
  else
    printf '%s' "$DB_NAME"
  fi
}

# The mysql client's flag that turns off its shell-escape command: MySQL 8.4
# has --skip-system-command, MariaDB's client has --sandbox. Either way a
# `\!` or `system` line in a dump runs nothing.
detect_client_guard() {
  local help
  if [[ "$MODE" == compose ]]; then
    help="$(compose exec -T database mysql --help)"
  else
    help="$(mysql --help)"
  fi
  if grep -q -- '--system-command' <<<"$help"; then
    CLIENT_GUARD=(--skip-system-command)
  elif grep -q -- '--sandbox' <<<"$help"; then
    CLIENT_GUARD=(--sandbox)
  fi
}

# mysql against the instance's database, with any further arguments. The
# database is the positional argument, never -D: both MySQL's and MariaDB's
# clients apply --one-database only to a database named that way, and with -D
# they skip every statement and exit 0 (measured on 8.4.11 and 10.11).
db_mysql() {
  if [[ "$MODE" == compose ]]; then
    # shellcheck disable=SC2016  # expanded by the container's shell, not this one
    compose exec -T database sh -c \
      'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --default-character-set=utf8mb4 "$@" --protocol=TCP -h 127.0.0.1 -u "$MYSQL_USER" "$MYSQL_DATABASE"' \
      mysql ${CLIENT_GUARD[@]+"${CLIENT_GUARD[@]}"} "$@"
  else
    MYSQL_PWD="$DB_PASS" mysql --default-character-set=utf8mb4 ${CLIENT_GUARD[@]+"${CLIENT_GUARD[@]}"} "$@" \
      --protocol=TCP -h "$DB_HOST" -u "$DB_USER" "$DB_NAME"
  fi
}

# One query's rows, tab-separated, no header.
db_query() {
  db_mysql -N -B -e "$1"
}

# mysqldump of the instance's database to stdout.
db_dump() {
  if [[ "$MODE" == compose ]]; then
    # shellcheck disable=SC2016  # expanded by the container's shell, not this one
    compose exec -T database sh -c \
      'MYSQL_PWD="$MYSQL_PASSWORD" exec mysqldump "$@" --protocol=TCP -h 127.0.0.1 -u "$MYSQL_USER" "$MYSQL_DATABASE"' \
      mysqldump "${DUMP_FLAGS[@]}"
  else
    MYSQL_PWD="$DB_PASS" mysqldump "${DUMP_FLAGS[@]}" --protocol=TCP -h "$DB_HOST" -u "$DB_USER" "$DB_NAME"
  fi
}

# A gzipped tar of the uploads directory to stdout.
uploads_out() {
  if [[ "$MODE" == compose ]]; then
    compose run --rm --no-deps -T app tar -czf - -C /app/public .
  else
    [[ -d "$UPLOADS_DIR" ]] || die "uploads directory $UPLOADS_DIR does not exist"
    tar -czf - -C "$UPLOADS_DIR" .
  fi
}

# Unpack a gzipped tar from stdin into the uploads directory. With `replace`,
# avatars/ and doc-images/ are emptied first, and nothing else is removed.
uploads_in() {
  local replace="$1"
  if [[ "$MODE" == compose ]]; then
    # shellcheck disable=SC2016  # expanded by the container's shell, not this one
    compose run --rm --no-deps -T app sh -c \
      'set -e
       if [ "$1" = replace ]; then
         for d in /app/public/avatars /app/public/doc-images; do
           if [ -d "$d" ]; then find "$d" -mindepth 1 -delete; fi
         done
       fi
       exec tar -xzpf - --no-same-owner -C /app/public' sh "$replace"
  else
    mkdir -p "$UPLOADS_DIR"
    if [[ "$replace" == replace ]]; then
      local d
      for d in "$UPLOADS_DIR/avatars" "$UPLOADS_DIR/doc-images"; do
        if [[ -d "$d" ]]; then find "$d" -mindepth 1 -delete; fi
      done
    fi
    tar -xzpf - --no-same-owner -C "$UPLOADS_DIR"
  fi
}

# The app's version, from the image (Compose) or the checkout (--local).
app_version() {
  local version=""
  if [[ "$MODE" == compose ]]; then
    version="$(compose run --rm --no-deps -T app node -p 'require("./package.json").version' 2>/dev/null || true)"
  elif command -v node >/dev/null 2>&1; then
    version="$(node -p 'require(process.argv[1]).version' "$REPO_ROOT/cloudcodex/package.json" 2>/dev/null || true)"
  fi
  version="$(printf '%s' "$version" | tr -d '\r\n')"
  if [[ "$version" =~ ^[0-9A-Za-z.+-]{1,64}$ ]]; then
    printf '%s' "$version"
  else
    printf 'unknown'
  fi
}
