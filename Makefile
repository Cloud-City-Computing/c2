# Cloud Codex – Helper Commands
#
# All Rights Reserved to Cloud City Computing, LLC 2026
# https://cloudcitycomputing.com

include .env
export

DB_CONTAINER = $$(docker compose ps -q database)

.PHONY: seed reset-db db-shell backup restore

## Load seed data (wipes existing data)
seed:
	docker exec -i $(DB_CONTAINER) mysql -u$(DB_USER) -p$(DB_PASS) $(DB_NAME) < seed.sql
	@echo "✔ Seed data loaded"

## Re-run init.sql schema then seed
reset-db:
	docker exec -i $(DB_CONTAINER) mysql -u$(DB_USER) -p$(DB_PASS) $(DB_NAME) < init.sql
	docker exec -i $(DB_CONTAINER) mysql -u$(DB_USER) -p$(DB_PASS) $(DB_NAME) < seed.sql
	@echo "✔ Database reset and seeded"

## Open a MySQL shell
db-shell:
	docker exec -it $(DB_CONTAINER) mysql -u$(DB_USER) -p$(DB_PASS) $(DB_NAME)

## Back the instance up into one archive (docs/deployment.md, Backups):
##   make backup OUT=backups/c2-$(date +%F).tar.gz
## COMPOSE_FILE picks the stack; the default is docker-compose-release.yml.
backup:
	@test -n "$(OUT)" || { echo "usage: make backup OUT=<file.tar.gz>" >&2; exit 2; }
	scripts/backup.sh "$(OUT)"

## Restore an archive into a stopped stack, then start it:
##   make restore IN=<file.tar.gz> [ARGS="--replace"]
restore:
	@test -n "$(IN)" || { echo "usage: make restore IN=<file.tar.gz> [ARGS=\"--replace\"]" >&2; exit 2; }
	scripts/restore.sh $(ARGS) "$(IN)"
