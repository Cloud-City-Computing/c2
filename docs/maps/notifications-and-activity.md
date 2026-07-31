# Notifications, Activity & Watches Map

Three interlocking subsystems that the root `CLAUDE.md` predates and does not
describe: an append-only activity log, a per-user watch registry, and a single
notification funnel that both feed. They are wired together inside one helper,
which is the part most likely to surprise you.

---

## 1. The shape

```
  a route or the collab WS
        │
        ├── processMentionsOnSave()  ──────────────┐   routes/helpers/mentions.js
        │                                          │
        └── logActivity()                          │   routes/helpers/activity.js
                │                                  │
                ├── INSERT activity_log            │
                ├── applyAutoWatch()   ─► watches  │
                └── fanOutToWatchers() ────────────┤
                                                   ▼
                                       createNotification()   services/notifications.js
                                                   │
                                    ┌──────────────┼──────────────┐
                                    ▼              ▼              ▼
                              INSERT               WS push        email
                              notifications   user-channel.js   email.js + templates
```

The load-bearing surprise: **`logActivity` is not just a logger.** It also
enrols the actor as a watcher and fans notifications out to every other watcher
(`routes/helpers/activity.js:92-93`). Adding a `logActivity` call to a new route therefore
starts sending people email. That is usually what you want, but it is not what
the name suggests.

## 2. `logActivity` (`routes/helpers/activity.js:50-94`)

Fire-and-forget by construction: it returns `void`, wraps everything in a
promise chain, and swallows errors into `console.error`
(`routes/helpers/activity.js:50-56`). A failed activity write never breaks the user's request.
Callers do not `await` it.

```js
logActivity({ user, action, resourceType, resourceId, metadata, workspaceId?, squadId? })
```

Steps:

1. Bail unless `user.id`, `action`, `resourceType`, `resourceId` are all present
   (`routes/helpers/activity.js:59`).
2. If `workspaceId` was not passed, `resolveScope()` walks the parent chain
   (`routes/helpers/activity.js:219-277`): log → archive → squad → workspace, with dedicated
   branches for `archive`, `comment`, `squad`, and `version` resource types.
   **If the scope cannot be resolved, the event is dropped silently**
   (`routes/helpers/activity.js:65`, `routes/helpers/activity.js:68`). An archive with `squad_id NULL`, such
   as the GitHub PR-session system archive, produces no activity at all.
3. `log.update` events from the same user for the same log inside a **5-minute**
   window are coalesced away entirely (`routes/helpers/activity.js:22`, `routes/helpers/activity.js:71-82`).
   No other action type is coalesced.
4. Insert the row, then auto-watch, then fan out.

### The action taxonomy

Eighteen values are currently emitted across the codebase:

```
archive.create   archive.delete   archive.rename
log.create       log.delete       log.rename      log.update
log.publish      log.restore
comment.create   comment.delete   comment.reply   comment.reopen
version.delete
squad.invite_create   squad.member_join   squad.member_leave
```

`resourceType` is one of `log`, `archive`, `comment`, `squad`, `version`.
Note the asymmetry: a comment event carries `resourceId = comment.id` and puts
the document id in `metadata.log_id`, which the fan-out then reads back
(`routes/helpers/activity.js:177`).

### Auto-watch (`routes/helpers/activity.js:32-36`, `routes/helpers/activity.js:102-127`)

Three rules, all `INSERT IGNORE` so they are idempotent:

| Action | Actor starts watching | `watches.source` |
|---|---|---|
| `log.create` | the new log | `auto_create` |
| `log.update` | the log | `auto_edit` |
| `comment.create` | the comment's parent log | `auto_comment` |

Because auto-watch runs *after* the `log.update` coalescing check, a user whose
update was coalesced away does not get auto-watched on that edit. They will on
the next non-coalesced one.

### Watcher fan-out (`routes/helpers/activity.js:171-212`)

Only five actions map to a notification type (`routes/helpers/activity.js:24-30`):

```
log.update      -> watched_log_update
log.publish     -> watched_publish
log.restore     -> watched_publish
comment.create  -> watched_comment
comment.reply   -> watched_comment
```

`collectWatchers(logId)` (`routes/helpers/activity.js:135-158`) unions direct watchers of the
log with watchers of its parent **archive**, so watching an archive cascades to
every document in it. The actor is excluded (`routes/helpers/activity.js:198`), and
`createNotification` self-suppresses again as a second line of defence.

Fan-out is a **sequential `await` loop**, one `createNotification` per watcher.
For a heavily-watched archive that is a lot of serial round trips inside a
fire-and-forget promise. Fine at current scale, worth knowing before someone
watches a 500-document archive.

## 3. Watches (`routes/watches.js`)

Four routes, all `requireAuth`. `resource_type` is allow-listed to `log` and
`archive` (`watches.js:25`).

- `GET /api/watches` lists with a resolved `resource_name` via correlated
  subqueries (`watches.js:37-51`).
- `GET /api/watches/:type/:id` returns `{ watching, source }`.
- `POST /api/watches` **checks read access first** through
  `userCanReadResource` (`watches.js:27-32`, `watches.js:84-87`), then upserts
  with `source = 'manual'`. Idempotent.
- `DELETE /api/watches/:type/:id` is idempotent and does not check access,
  which is correct: removing your own watch needs no permission.

A manual watch overwrites an auto one (`ON DUPLICATE KEY UPDATE source =
'manual'`, `watches.js:90-93`), but an auto-watch never overwrites a manual one
because it uses `INSERT IGNORE`.

Unwatching does not prevent re-auto-watching: edit the document again and
`auto_edit` puts the watch straight back.

## 4. `createNotification` (`services/notifications.js:86-159`)

The single funnel. Everything that alerts a user goes through it.

```js
createNotification({
  recipientId, actorId, type, title, body,
  linkUrl, resourceType, resourceId, metadata, emailData
})
```

In order:

1. Require `recipientId`, `type`, `title`; else `null` (`services/notifications.js:100`).
2. **Self-suppression**: `actorId === recipientId` returns `null`
   (`services/notifications.js:101`).
3. **Coalescing**: if `resourceType` and `resourceId` are both set and a row
   with the same `(user_id, type, resource_type, resource_id)` was created
   within **60 seconds**, return `null` (`services/notifications.js:20`,
   `services/notifications.js:104-114`). A notification without a resource is never
   coalesced.
4. Sanitise: title goes through `sanitizeHtml` then a tag strip and a 255-char
   cap; body through `sanitizeHtml` and a 2000-char cap
   (`services/notifications.js:119-120`). This is defence in depth, since React and the
   email templates already escape.
5. Insert, then **fire-and-forget** the WS push (`services/notifications.js:147-151`) and
   the email (`services/notifications.js:154-156`). Neither is awaited, so a dead SMTP
   server cannot slow a save.

**Two independent coalescing windows exist and are easy to conflate:**
activity's is 5 minutes and applies only to `log.update`
(`routes/helpers/activity.js:22`); notifications' is 60 seconds and applies to every type with
a resource (`services/notifications.js:20`).

### Types and email preferences

Six types, defined by `DEFAULT_EMAIL_PREFS` (`services/notifications.js:27-34`):

| Type | Email by default | Emitted from |
|---|---|---|
| `mention` | yes | `mentions.js:142`, `comments.js:196` |
| `comment_on_my_doc` | yes | `comments.js:216` |
| `watched_comment` | yes | `routes/helpers/activity.js:199` |
| `watched_publish` | yes | `routes/helpers/activity.js:199` |
| `watched_log_update` | **no** | `routes/helpers/activity.js:199` |
| `squad_invite` | yes (but see below) | `squads.js:428` |

Resolution (`services/notifications.js:36-46`): look up `email_<type>` in the user's
`users.notification_prefs` JSON; if that key is absent, fall back to the
default. `setPrefs` (`services/notifications.js:273-286`) whitelists to exactly the six
known keys and coerces to boolean, so a client cannot inject arbitrary JSON.

**`squad_invite` has a preference key but no email template.** `builders` in
`services/email-templates.js:59` defines only `mention`,
`comment_on_my_doc`, `watched_log_update`, `watched_publish`,
`watched_comment`. `buildNotificationEmail` returns `null` for anything else
and `deliverEmail` bails (`services/notifications.js:170`). Squad invites do still send
email, but through a direct `sendEmail` call in `routes/squads.js:399`, which
does **not** consult the user's notification preferences. Recorded in
[open-questions.md](open-questions.md).

### Reads

`listForUser` (`services/notifications.js:225-251`) is cursor-paginated on
`created_at < before`, limit clamped to 1..100, joined to `users` for actor
name and avatar. `getUnreadCount` (`services/notifications.js:212`) backs the badge.
`markRead` (`services/notifications.js:184-195`) is scoped `AND user_id = ?` so one user
cannot mark another's notification read, and it pushes `{type:'read', id}` to
the owner's tabs.

## 5. Mentions (`routes/helpers/mentions.js`)

Mentions are `<span data-mention-user-id="42">` nodes emitted by the Tiptap
`Mention` extension (`src/extensions/Mention.jsx`).

- `extractMentions(html)` (`mentions.js:40-51`) regex-matches the attribute
  after stripping `<pre>`, `<code>`, `<script>`, `<style>` blocks
  (`mentions.js:27-34`), so an `@name` inside a code fence never notifies.
- `diffMentions(prev, next)` (`mentions.js:57-65`) returns only the **newly
  added** ids, which is what makes re-saving a document idempotent.
- `processMentionsOnSave(ctx)` (`mentions.js:120-160`) loops the added ids,
  loads each recipient, **verifies `checkLogReadAccess` for that recipient**
  (`mentions.js:137-138`), builds a context snippet, and calls
  `createNotification`. A mention of someone who cannot read the document
  notifies nobody, which prevents mention-based information leakage.

`extractContextSnippet` (`mentions.js:71-93`) produces ~160 characters of
plain-text context around the mention for the inbox preview and email body.

Called from four places: REST save (`documents.js:129`), version restore
(`documents.js:449`), WS save (`collab.js:481`), WS publish
(`collab.js:577`). The comment path does its own extraction inline rather than
reusing `processMentionsOnSave`, because comment content is plain text with a
different link target (`comments.js:186-209`).

## 6. Comment notifications (`routes/comments.js:172-232`)

On comment create, two notifications can fire:

1. One `mention` per mentioned user who passes `checkLogReadAccess`.
2. One `comment_on_my_doc` to the document's `created_by`, **skipped** if the
   creator is the comment author or was already mentioned
   (`comments.js:214-218`), so nobody gets two pings for one comment.

The whole block is wrapped in try/catch and logged
(`comments.js:230-232`): a notification failure never fails the comment.
`logActivity('comment.create')` then runs separately and triggers the
watcher fan-out.

## 7. The user-scoped WebSocket (`services/user-channel.js`)

Push-only, one connection per tab, keyed by user rather than by document. A user
holds one of these regardless of which document is open, which is the whole
distinction from `/collab`.

- Path `/notifications-ws`, same-origin enforced, 5s auth timeout, 10
  connections per user (`user-channel.js:22-23`).
- State is `Map<userId, Set<ws>>` (`user-channel.js:26`).
- `broadcastToUser(userId, message)` (`user-channel.js:48-64`) returns the
  number of sockets written; `0` means the user has no tab open, which is not an
  error. Send failures are swallowed because the `close` handler untracks.
- Frames sent: `connected`, `notification`, `read`, `read_all`.

The client side is `src/hooks/useNotificationChannel.js`, feeding
`NotificationBell.jsx`.

**Nothing is queued for offline users.** A missed push is recovered only by the
REST poll on next load. The DB row is the source of truth; the socket is a
latency optimisation.

## 8. Activity read path (`routes/activity.js`)

`GET /api/activity?workspace=<id>` (`routes/activity.js:63`) is the interesting one.
It gates the workspace itself, then filters every row through a composed
access clause (`routes/activity.js:88-117`) that applies `readAccessWhere` **four
separate times**, once each for the `log`, `archive`, `comment`, and `version`
resource types, with rows of other types passing through unfiltered.

That means **28 bound access params in one query**
(`routes/activity.js:119-124`), and the comment in the source says so. If you ever
change the arity of `readAccessParams`, this query is the one most likely to
break silently. See [access-control.md](access-control.md).

`GET /api/activity/log/:logId` (`routes/helpers/activity.js:145`) is the per-document
variant. Retention is 365 days, enforced by the daily prune in
`server.js:49-67`.

---

## Related

- [access-control.md](access-control.md) for the fragment arity that
  `activity.js` multiplies by four.
- [documents-and-collab.md](documents-and-collab.md) for the save paths that
  call `processMentionsOnSave` and `logActivity`.
- [data-model.md](data-model.md) for the `activity_log`, `watches`, and
  `notifications` tables and their indexes.
