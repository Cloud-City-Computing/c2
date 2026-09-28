# Several Cloud Codex instances on one MySQL server: the isolation proof

W6-CDX-33, 2026-09-28. The evidence for "one container and one schema per
customer" on a shared MySQL server: that the recipe in
[`docs/deployment.md`](../../deployment.md#several-instances-on-one-mysql-server)
keeps each instance inside its own schema, and that the app still runs on what
the recipe gives it. It re-verifies, and widens, the eleven-shape proof Cloud
Command's Wave 5 research ran against MySQL 8.4.8 on 2026-08-24, which that
research itself listed as its largest unre-verified claim.

## What ran

- Server: the stock `mysql:8.4.11` image, the version every compose file pins,
  with its defaults: `partial_revokes` OFF, binary logging ON,
  `max_connections` 151, `secure_file_priv` `/var/lib/mysql-files/`,
  `local_infile` OFF. A throwaway container with no published port, reached on
  its container address.
- Client: Node 22, `mysql2` from `cloudcodex/node_modules`, Vitest 4.
- `cloudcodex/tests/integration/tenancy.test.js` and
  `grants-sufficient.test.js`, in the full integration run (14 files, 163
  tests, all passing). The lines for the two new files are in
  [`raw-integration-run.txt`](raw-integration-run.txt).

Both files read the SQL block out of `docs/deployment.md` and run it as root
(`tests/integration/instance-recipe.js`), with throwaway names and passwords in
place of the example's, so the recipe proved is the recipe documented. Instance
A's schema is built by the fresh-install path (`init.sql`, then
`--adopt-fresh-install`) and instance B's by the upgrade path (`init.sql` taken
back to the pre-runner state, `--baseline`, then every newer migration applied
for real), both as that instance's migration account.

## Result

As instance A's app account, 44 statements, and as its migration account, 10,
each fail with the exact error below. Instance B holds a row A would find if
any succeeded.

| Error | Statements |
|---|---|
| 1142 `ER_TABLEACCESS_DENIED_ERROR` | `SELECT` on B (schema-qualified, backticked), `INSERT`, `UPDATE`, `DELETE`, `REPLACE`, a `JOIN` and a comma join with A's tables, a subquery, a CTE named after a real table, `UNION`, `TABLE`, `CREATE VIEW` and `CREATE TABLE ... SELECT` over B, `SHOW CREATE TABLE`, `DESCRIBE`, `SHOW INDEX`, `HANDLER ... OPEN`, `PREPARE`, `RENAME TABLE` into B, `SHOW GRANTS FOR` B's account, `mysql.user`, `performance_schema` statement history, threads and data locks, `sys.processlist`; as the app account, `CREATE TABLE` and `ALTER TABLE` on its own schema; as the migration account, `SELECT`, `CREATE TABLE`, `ALTER TABLE` and `DROP TABLE` on B |
| 1044 `ER_DBACCESS_DENIED_ERROR` | `USE`, `SHOW TABLES FROM`, `SHOW TABLE STATUS FROM`, `LOCK TABLES`, `DROP DATABASE` on B; a `GRANT` on B to itself; a `GRANT` on its own schema to B's account (the migration account too: it has no `GRANT OPTION`); `CREATE TEMPORARY TABLE` on its own schema |
| 1370 `ER_PROCACCESS_DENIED_ERROR` | `CALL` of a procedure in B |
| 1095 `ER_KILL_DENIED_ERROR` | `KILL` and `KILL QUERY` of B's connection |
| 1227 `ER_SPECIFIC_ACCESS_DENIED_ERROR` | `SELECT ... INTO OUTFILE`, `SET GLOBAL`, `CREATE USER`, `information_schema.INNODB_TRX` |
| 1045 `ER_ACCESS_DENIED_ERROR` | `LOAD DATA INFILE` (MySQL answers a missing `FILE` privilege here with 1045) |

And, as instance A's app account:

- `SHOW DATABASES` returns exactly `information_schema`, `performance_schema`
  and its own schema. `performance_schema` is visible to every account; the
  tables in it that name other sessions' work are the 1142s above, and its
  `processlist` shows the caller its own connections only.
- `information_schema` `TABLES`, `COLUMNS`, `ROUTINES` and `SCHEMATA` hold no
  row about B.
- **B's name is not hidden.** Of the 55 `information_schema` and
  `performance_schema` views the app account can read, exactly one names B:
  `information_schema.TABLESPACES_EXTENSIONS`, which MySQL shows without a
  privilege check and which lists every file-per-table tablespace on the
  server as `<schema>/<table>` (a row `<B>/users`). No `SHOW` statement the
  account may run names B. So the grant keeps B's rows, grants and
  `SHOW DATABASES` entry from A, not B's schema and table names; the recipe
  says so and asks for opaque schema names. The test pins the one view: a
  second view naming B, or none, turns it red. `performance_schema.global_status`
  (server-wide counters) is readable too.
- `LOAD_FILE('/etc/hostname')` returns `NULL`.
- `SHOW GRANTS` is exactly `GRANT USAGE ON *.*` plus the one schema line, for
  both accounts.
- The app account's `MAX_USER_CONNECTIONS` refuses the connection past it with
  1226 `ER_USER_LIMIT_REACHED`, while B's app account still connects.
- Each instance's app account holds its own single-writer lock at the same
  time, and a second holder on A is refused naming the first.

`grants-sufficient.test.js` booted `server.js` in production mode as the
recipe's app account alone and ran the boot (instance lock, admin sync, first
run seed), a signed-in path (workspace, squad, archive, document, save, a
rename inside `SELECT ... FOR UPDATE`, comment, publish, search, a comment
delete, a document delete, sign-out), one `/collab` edit and a SIGTERM that
flushed it: every answer 2xx, exit 0 with `stopped cleanly on SIGTERM`, no
privilege error in the log, and the edit in `ydoc_state`.

## Through the compose file

The recipe as first written adopted the schema with
`docker compose -f docker-compose-release.yml run ... npm run migrate`, which
never reaches a shared server: the release file sets the app's `DB_HOST` to its
bundled `database` service (`environment` wins over `.env`) and makes the app
depend on it, so the command starts a new MySQL of the install's own. The
recipe now carries a `shared-mysql.yml` override (the bundled database behind a
profile, the dependency reset, `DB_HOST` from `.env`). Driven for real against
a throwaway server standing in for the shared one, it adopts the schema as the
migration account, starts the app as the app account (`/readyz` 200, the
instance lock held by the app account), and a command that forgets the
override fails at the bundled database instead of starting an empty one:
[`raw-compose-run.txt`](raw-compose-run.txt).

## The schema-name rule

The Wave 6 plan's recipe granted `ON c2_acme.*`. In a database-level `GRANT`,
MySQL reads `_` and `%` in the schema name as wildcards while `partial_revokes`
is OFF (the default), so that grant also opens `c2xacme`. Escaping the
underscore (`` `c2\_acme` ``) fixes it with `partial_revokes` OFF, but with it
ON the backslash is literal and the account loses its own schema.
[`grant-wildcards.mjs`](grant-wildcards.mjs) shows all three; its output is
[`raw-grant-wildcards.txt`](raw-grant-wildcards.txt). The recipe therefore
names schemas with lowercase letters and digits only, which means the same
thing under either setting, and backticks them. The last test in
`tenancy.test.js` keeps the wildcard behaviour demonstrated on the CI server.

## Mutations

Ten, each confirmed landed and restored: [`raw-mutations.txt`](raw-mutations.txt).
The plan's own (`GRANT SELECT ON *.*` to the app account) turns 26 tests red.
One found a gap in the proof: without `DELETE` the smoke path first stayed
green, because it deleted nothing, and extending it found that
`routes/comments.js` answered a failing query with Express's HTML error page.

## Reproducing

```sh
docker run -d --rm --name c2-it-isolation -e MYSQL_ROOT_PASSWORD=<pw> mysql:8.4.11
IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' c2-it-isolation)
cd cloudcodex && IT_DB_HOST=$IP IT_DB_ROOT_PASSWORD=<pw> npm run test:integration
cd .. && IT_DB_HOST=$IP IT_DB_ROOT_PASSWORD=<pw> node docs/research/instance-isolation-2026-09-28/grant-wildcards.mjs
docker stop c2-it-isolation
```
