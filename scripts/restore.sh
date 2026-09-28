#!/usr/bin/env bash
#
# Restore one Cloud Codex instance from an archive scripts/backup.sh wrote.
#
# All Rights Reserved to Cloud City Computing, LLC 2026
# https://cloudcitycomputing.com
#
# usage: scripts/restore.sh [--local [--uploads DIR]] [--into NAME] [--replace] [--no-start] <archive.tar.gz>
#
# Everything is checked before anything is written, and each check is a
# refusal:
#   - the archive holds exactly its three members, and each payload matches
#     the manifest's SHA-256;
#   - the uploads hold only regular files and directories, with no absolute
#     path and no `..`;
#   - the dump has no statement that switches, creates or drops a database and
#     no mysql client command (`\!`, `system`, `source`, `connect`, ...) at
#     the start of a line (the client runs with --binary-mode, so one anywhere
#     else on a line never runs: the client refuses it and the load stops);
#   - the target is this instance's own database, never a system schema, and
#     the archive's database has the same name, unless --into names the target
#     (moving a backup to a differently named database is deliberate);
#   - the app is not running, and nothing holds the instance lock that
#     cloudcodex/services/instance-lock.js takes for that database;
#   - the database holds no rows, unless --replace, which drops every table
#     in it (and empties avatars/ and doc-images/) before the load. Tables
#     with no rows at all (a new stack, where the database service has just
#     built init.sql) are dropped without it: nothing is lost.
#
# The load runs as the instance's own MySQL user, which the database service
# grants everything on its own schema and nothing else, so a statement that
# names another schema fails on the grant. It takes the instance lock first,
# or stops there if a server took it since the check, and holds it throughout,
# so an app that starts meanwhile refuses. Then the uploads are
# unpacked, and (Compose, unless --no-start) pending migrations run and the
# stack starts.

set -euo pipefail
umask 077

# shellcheck source=scripts/backup-common.sh
. "$(dirname "${BASH_SOURCE[0]}")/backup-common.sh"

usage() {
  die "usage: scripts/restore.sh [--local [--uploads DIR]] [--into NAME] [--replace] [--no-start] <archive.tar.gz>"
}

archive=""
into=""
replace=""
start=yes
while (($#)); do
  case "$1" in
    --local) MODE=local ;;
    --uploads)
      (($# >= 2)) || usage
      UPLOADS_DIR="$2"
      shift ;;
    --into)
      (($# >= 2)) || usage
      into="$2"
      shift ;;
    --replace) replace=replace ;;
    --no-start) start=no ;;
    -h | --help) usage ;;
    -*) die "unknown option $1" ;;
    *)
      [[ -z "$archive" ]] || usage
      archive="$1" ;;
  esac
  shift
done
[[ -n "$archive" ]] || usage
[[ "$MODE" == local || -z "$UPLOADS_DIR" ]] || die "--uploads goes with --local"
[[ -f "$archive" && -r "$archive" ]] || die "cannot read $archive"

setup_transport

work="$(mktemp -d "${TMPDIR:-/tmp}/cloudcodex-restore.XXXXXX")"
cleanup() {
  rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ---- the archive -----------------------------------------------------------

members="$(tar -tzf "$archive" | LC_ALL=C sort)" || die "$archive is not a gzipped tar"
[[ "$members" == "$ARCHIVE_MEMBERS" ]] ||
  die "$archive must hold exactly app_public.tar.gz, database.sql and manifest.json"
# Listings go through a variable: under pipefail, `tar | grep -q` can report
# tar's SIGPIPE instead of grep's match, and a hit would read as a miss.
listing="$(tar -tvzf "$archive")"
if grep -qv '^-' <<<"$listing"; then
  die "$archive holds something other than three regular files"
fi
tar -xzf "$archive" -C "$work" --no-same-owner

declare -A manifest=()
while IFS= read -r line; do
  if [[ "$line" =~ ^[[:space:]]*\"([a-z0-9_]+)\":[[:space:]]*\"?([^\",]*)\"?,?[[:space:]]*$ ]]; then
    manifest["${BASH_REMATCH[1]}"]="${BASH_REMATCH[2]}"
  fi
done <"$work/manifest.json"

[[ "${manifest[format]:-}" == "$ARCHIVE_FORMAT" ]] ||
  die "manifest.json is not format $ARCHIVE_FORMAT; this script cannot restore it"
source_database="${manifest[database]:-}"
[[ "$source_database" =~ ^[A-Za-z0-9_$-]{1,64}$ ]] || die "manifest.json names no usable database"

for pair in database.sql:database_sql_sha256 app_public.tar.gz:app_public_sha256; do
  member="${pair%%:*}"
  expected="${manifest[${pair#*:}]:-}"
  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || die "manifest.json has no SHA-256 for $member"
  [[ "$(sha256_of "$work/$member")" == "$expected" ]] ||
    die "$member does not match the manifest's checksum; the archive is damaged or was changed"
done

listing="$(tar -tvzf "$work/app_public.tar.gz")"
if grep -qv '^[-d]' <<<"$listing"; then
  die "the uploads may hold only regular files and directories"
fi
listing="$(tar -tzf "$work/app_public.tar.gz")"
if grep -qE '^/|(^|/)\.\.(/|$)' <<<"$listing"; then
  die "the uploads hold an absolute path or a path through .."
fi

# A mysqldump of one schema never has these at the start of a line, and a row
# never starts a line with anything but `(` or INSERT, so a hit is a dump
# someone wrote by hand or changed. `\` covers every client command in short
# form, the words cover the long forms that reach a file, a shell or a server.
hostile='^[[:space:]]*(\\|(use|connect|source|system|tee|pager|edit|ssl_session_data_print)([[:space:];]|$)|(/\*![0-9]*[[:space:]]*)?(create|drop|alter)[[:space:]]+(database|schema)([[:space:]`;]|$))'
if hit="$(grep -niE -m 1 "$hostile" "$work/database.sql")"; then
  die "refusing to load database.sql: line ${hit%%:*} switches, creates or drops a database or runs a client command"
fi

# ---- the target ------------------------------------------------------------

if [[ "$MODE" == compose ]]; then
  running="$(compose ps --status running --services)"
  if grep -qx app <<<"$running"; then
    die "the app is running; stop it first (docker compose stop app), then restore"
  fi
  say "Starting the database service ..."
  compose up -d --wait database >&2
fi

target="$(target_database)"
check_database_name "$target"
if [[ -n "$into" && "$into" != "$target" ]]; then
  die "--into names '$into', but this instance's database is '$target'"
fi
if [[ "$source_database" != "$target" && -z "$into" ]]; then
  die "this archive is a backup of database '$source_database', and this instance's database is '$target'. To restore it there anyway, pass --into $target"
fi

detect_client_guard

# The service it just started may still be building init.sql (see
# backup-common.sh), and a compose file from before its healthcheck moved to
# TCP calls that healthy, so give the real server time to answer.
max_wait=0
if [[ "$MODE" == compose ]]; then max_wait=180; fi
for ((waited = 0; ; waited += 2)); do
  if db_query 'SELECT 1' >/dev/null 2>&1; then break; fi
  ((waited < max_wait)) ||
    die "cannot reach database '$target' as this instance's MySQL user; does it exist? ($(db_query 'SELECT 1' 2>&1 >/dev/null | tail -n 1))"
  sleep 2
done

lock_free="$(db_query "SELECT IS_FREE_LOCK($INSTANCE_LOCK_NAME_SQL)")"
[[ "$lock_free" == 1 ]] ||
  die "a Cloud Codex process holds the instance lock for '$target'; stop it, then restore"

tables="$(db_query 'SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()')"
clear_tables="$replace"
if [[ "$tables" != 0 && -z "$replace" ]]; then
  # Tables without a single row are what the database service builds from
  # init.sql the first time it starts, so a new stack is not a refusal:
  # dropping them loses nothing. One row anywhere is.
  count_sql="$(db_query "SET SESSION group_concat_max_len = 1048576; SELECT CONCAT('SELECT ', GROUP_CONCAT(CONCAT('(SELECT COUNT(*) FROM \`', REPLACE(TABLE_NAME, '\`', '\`\`'), '\`)') SEPARATOR ' + ')) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'")"
  rows=0
  if [[ "$count_sql" != NULL ]]; then
    rows="$(db_query "$count_sql")"
  fi
  [[ "$rows" == 0 ]] ||
    die "database '$target' already holds data ($tables tables). Restoring over it needs --replace, which drops every table in '$target' first"
  say "Database $target has only empty tables (a new install's); they are replaced."
  clear_tables=replace
fi

# ---- the writes ------------------------------------------------------------

drops=""
if [[ -n "$clear_tables" ]]; then
  drops="$(db_query "SELECT CONCAT('DROP ', IF(TABLE_TYPE = 'VIEW', 'VIEW', 'TABLE'), ' IF EXISTS \`', REPLACE(TABLE_NAME, '\`', '\`\`'), '\`;') FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()")"
fi

say "Loading database.sql into $target ..."
# One session: it takes the instance lock (TAKE_LOCK_SQL fails, and the
# client stops, if a server took it since the check above), drops what
# --replace drops, then loads, so no app can start on a half-loaded database.
# --one-database skips anything that would run with another database current.
load_ok=yes
{
  printf '%s;\n' "$TAKE_LOCK_SQL"
  printf 'SET FOREIGN_KEY_CHECKS = 0;\n%s\nSET FOREIGN_KEY_CHECKS = 1;\n' "$drops"
  cat "$work/database.sql"
} | db_mysql --one-database 2>"$work/load.err" || load_ok=no
cat "$work/load.err" >&2
if [[ "$load_ok" == no ]]; then
  if grep -q 'at line 1: .*another process holds the instance lock' "$work/load.err"; then
    die "a Cloud Codex process took the instance lock for '$target' as the load began; nothing was written. Stop it, then restore"
  fi
  die "the load into '$target' failed part way, so it holds part of the backup. Fix the cause and run the restore again with --replace"
fi

# The load reporting success is not enough: a client that skipped statements
# (see db_mysql) exits 0 too. Every table the dump creates must now exist.
created="$(grep -c '^CREATE TABLE ' "$work/database.sql" || true)"
tables="$(db_query 'SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()')"
[[ "$created" -gt 0 && "$tables" == "$created" ]] ||
  die "the load into '$target' left $tables tables where the dump creates $created. Fix the cause and run the restore again with --replace"

say "Unpacking the uploads ..."
uploads_in "$replace" <"$work/app_public.tar.gz"

if [[ "$MODE" == compose && "$start" == yes ]]; then
  say "Applying any migrations newer than the backup ..."
  compose run --rm app npm run migrate >&2
  say "Starting the stack ..."
  compose up -d >&2
  printf 'Restored %s into %s and started it; /readyz answers 200 once it is ready.\n' "$archive" "$target"
elif [[ "$MODE" == compose ]]; then
  printf 'Restored %s into %s. Next: docker compose run --rm app npm run migrate, then docker compose up -d.\n' "$archive" "$target"
else
  printf 'Restored %s into %s. Next: npm run migrate from cloudcodex/, then start the app.\n' "$archive" "$target"
fi
