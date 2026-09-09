# Verification harness for the `/api/users/search` scoping query

The query lives in `cloudcodex/routes/auth.js`, in the non-admin branch of
`GET /api/users/search`. This directory is how it was checked against a real
MySQL, and how to check it again after an edit. The backend suite mocks
`c2_query`, so it can only assert the query's shape; only this harness answers
"which rows come back".

```sh
docker run -d --name c2-audit-verify -e MYSQL_ROOT_PASSWORD=verify \
  -e MYSQL_DATABASE=c2 -p 13306:3306 mysql:8
# wait for `docker exec c2-audit-verify mysqladmin ping -uroot -pverify --silent`
docker exec c2-audit-verify mysql -uroot -pverify -e "CREATE DATABASE c2search;"
docker exec -i c2-audit-verify mysql -uroot -pverify c2search < init.sql
docker exec -i c2-audit-verify mysql -uroot -pverify < docs/research/users-search-scope-2026-09-08/fixture.sql
node docs/research/users-search-scope-2026-09-08/verify.mjs
docker rm -f c2-audit-verify
```

`verify.mjs` extracts the query text from `routes/auth.js` verbatim, binds the
same seven params the route binds, refuses to run if the param count and the
placeholder count disagree, and runs it as a real prepared statement.

## What the fixture holds

Workspace W1 is owned by alice, who is in no squad. Squad S1 is in W1, with bob
as an ordinary member (no flags, no management standing) and dan as `role`
admin. Workspace W2 is owned by grace, also in no squad, with squad S2 and frank
as an ordinary member. erin is an SSO auto-provisioned account with no
`squad_members` row anywhere, and root is a platform admin (also with no squad
row, which is what an install's admin usually looks like).

## Result, 2026-09-08, `mysql:8` (server 8.4.8)

All twelve cases as expected. The four that carry the change:

| Caller | Query | Returns | Why |
|---|---|---|---|
| alice, owns W1, in no squad | `eri` | erin | unattached account, and owning a workspace qualifies her to invite |
| dan, `role` admin in S1 | `eri` | erin | unattached account, squad-management standing |
| bob, ordinary member | `eri` | nothing | the gate: an ordinary member gets no visibility of unattached accounts |
| bob | `ali` | alice | a workspace owner in no squad, now visible to their own members |

**The same fixture against the pre-fix query** (the route as it stood in commit
`b2f5775`, scoped on shared membership alone) returns `[]` for all four: erin was invisible
to everyone but a platform admin, including to both people who could have
invited her, and bob could not see his own workspace owner. That is the invite
flow severed, with an empty picker as the only symptom.

**One accepted cost, visible in the fixture.** dan searching `gra` returns
grace, the squad-less owner of another workspace. Anyone who can invite can see
every account that holds no squad membership, including out-of-tenant ones.
Narrowing "unattached" to exclude workspace owners would make a squad-less
workspace owner permanently uninvitable, which is the same defect one step over,
so the wider rule was kept.
