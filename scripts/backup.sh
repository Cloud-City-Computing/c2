#!/usr/bin/env bash
#
# Back up one Cloud Codex instance, its database and its uploads, into one archive.
#
# All Rights Reserved to Cloud City Computing, LLC 2026
# https://cloudcitycomputing.com
#
# usage: scripts/backup.sh [--local [--uploads DIR]] <output.tar.gz>
#
# The archive is readable by its owner only (0600) and is never written over:
# an existing output file is a refusal. It holds everything the database
# holds (password hashes, two-factor secrets, encrypted GitHub tokens), so
# keep it the way you keep the database. It does not hold .env or any key
# material. It runs as a MySQL user granted on the instance's database alone,
# never root. See "Backups" in docs/deployment.md, and scripts/backup-common.sh
# for the two transports.
#
# The dump is one consistent InnoDB snapshot and can be taken while the app
# runs, but collaborative edits still in the app's memory (at most the last
# few seconds) are only in it if the app was stopped cleanly first.

set -euo pipefail
umask 077

# shellcheck source=scripts/backup-common.sh
. "$(dirname "${BASH_SOURCE[0]}")/backup-common.sh"

usage() {
  die "usage: scripts/backup.sh [--local [--uploads DIR]] <output.tar.gz>"
}

out=""
while (($#)); do
  case "$1" in
    --local) MODE=local ;;
    --uploads)
      (($# >= 2)) || usage
      UPLOADS_DIR="$2"
      shift ;;
    -h | --help) usage ;;
    -*) die "unknown option $1" ;;
    *)
      [[ -z "$out" ]] || usage
      out="$1" ;;
  esac
  shift
done
[[ -n "$out" ]] || usage
[[ "$MODE" == local || -z "$UPLOADS_DIR" ]] || die "--uploads goes with --local"

out_dir="$(dirname "$out")"
[[ ! -e "$out" ]] || die "$out already exists; a backup never writes over one"
[[ -d "$out_dir" && -w "$out_dir" ]] || die "cannot write to $out_dir"

setup_transport

# The working files sit beside the output, on the disk that has room for it,
# not in a /tmp that may be memory.
work="$(mktemp -d "$out_dir/.cloudcodex-backup.XXXXXX")"
partial="$work/archive.tar.gz"
cleanup() {
  rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

database="$(target_database)"
check_database_name "$database"
check_confined_user "$database"

say "Dumping database $database ..."
db_dump >"$work/database.sql"
# mysqldump writes this line last, and only when it finished.
last_line="$(tail -n 1 "$work/database.sql")"
[[ "$last_line" == "-- Dump completed"* ]] || die "the dump of $database did not complete"

say "Archiving the uploads ..."
uploads_out >"$work/app_public.tar.gz"
gzip -t "$work/app_public.tar.gz" || die "the uploads archive is not a valid gzip stream"

printf '{\n  "format": %s,\n  "created_at": "%s",\n  "database": "%s",\n  "app_version": "%s",\n  "database_sql_sha256": "%s",\n  "app_public_sha256": "%s"\n}\n' \
  "$ARCHIVE_FORMAT" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$database" \
  "$(app_version)" \
  "$(sha256_of "$work/database.sql")" \
  "$(sha256_of "$work/app_public.tar.gz")" >"$work/manifest.json"

tar -czf "$partial" -C "$work" database.sql app_public.tar.gz manifest.json
chmod 600 "$partial"
# A hard link on the same filesystem: the output appears whole or not at all,
# and `ln` refuses rather than replace a file that appeared meanwhile.
ln "$partial" "$out" || die "$out appeared while the backup ran; left it alone"

printf 'Backup of %s written to %s\n' "$database" "$out"
