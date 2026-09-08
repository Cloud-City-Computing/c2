# Verification harness for the cross-tenant enumeration queries

The three queries live in [`docs/security.md`](../../security.md), section
"Auditing for Pre-existing Cross-tenant Rows". This directory is how they were
checked, and how to check them again after an edit.

```sh
docker run -d --name c2-audit-verify -e MYSQL_ROOT_PASSWORD=verify -e MYSQL_DATABASE=c2 mysql:8
# wait for `docker exec c2-audit-verify mysqladmin ping -uroot -pverify --silent`
docker exec -i c2-audit-verify mysql -uroot -pverify c2 < init.sql
docker exec -i c2-audit-verify mysql -uroot -pverify < docs/research/tenant-boundary-enumeration-2026-09-08/fixture.sql
# then paste each query from docs/security.md
docker rm -f c2-audit-verify
```

Do not mount `init.sql` into `/docker-entrypoint-initdb.d/` on a machine with
SELinux enforcing; the entrypoint gets `Permission denied` and starts an empty
database that looks fine. Pipe it in instead, as above.

`fixture.sql` holds, in workspace W1 owned by alice:

| Row | Should be reported by |
|---|---|
| S2, S3: squads planted by mallory, each enrolling her as squad owner | query 1, both of them |
| S8: squad created by bob in the ownerless workspace W2 | query 1 |
| A2: archive planted by mallory into alice's squad S1 | query 2 only with the extra clause the doc gives, because mallory's planted squads make her a W1 member |
| A6: archive planted by dave, who has no squad anywhere in W1 | query 2 |
| `A1.read_access` naming dave | query 3 |
| `A1.read_access_squads` naming S5, a squad in workspace W3 | query 3 |

and, as controls that must **not** be reported: S1 (by the workspace owner), S4
(by bob, a genuine member via a squad he did not create), S5 (carol in her own
workspace), S6 (by a platform admin), S7 (an orphaned squad, no workspace to be
outside of), A3, A4, A5 (a `system` archive with no squad), and the grants on A1
naming alice, bob, root and S1.

**The result that matters.** Query 1 written the naive way, "the creator is not
a member of this workspace", reports **nothing** on this fixture. Squad creation
calls `addSquadOwnerMember`, so the planted squad supplies the membership that
clears its own planter, and a second planted squad alibis the first. That is why
the shipped query excludes every squad in the workspace created by the user
under examination before testing membership.

Last run 2026-09-08 against `mysql:8` with the then-current `init.sql`.
