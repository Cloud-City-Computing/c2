# Cloud Codex – Helper Commands
#
# All Rights Reserved to Cloud City Computing, LLC 2026
# https://cloudcitycomputing.com

include .env
export

DB_CONTAINER = $$(docker compose ps -q database)

.PHONY: seed reset-db db-shell

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
