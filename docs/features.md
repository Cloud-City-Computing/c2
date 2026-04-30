```
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║   FEATURES                                                                 ║
║   Every major capability in Cloud Codex, in one read.                      ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
```

# Features

Cloud Codex is built around six pillars. Everything in this document is one of
the supporting features that makes one of them work.

```
                ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
                ┃           CLOUD  CODEX                ┃
                ┗━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━┛
                                   │
       ┌──────────┬────────┬───────┴──────┬──────────┬──────────┐
       │          │        │              │          │          │
   real-time   GitHub   layered      comments &  notifications  self-host
     CRDT     1st-class  access      annotations  + activity     in one box
```

---

## Real-Time Collaborative Editing

Multiple users can edit the same document simultaneously. Changes are merged
automatically using **Yjs CRDTs** (Conflict-free Replicated Data Types),
ensuring every user sees a consistent view without manual conflict resolution.
Remote cursors and text selections render in real time so collaborators can see
exactly where others are working.

---

## Presence Awareness

Live presence indicators show which users are currently viewing or editing each
log. Avatar badges appear throughout the interface — in the log tree sidebar,
the editor toolbar, the top navigation bar, and the explore/browse view —
giving squads immediate visibility into who is active. A dedicated presence
API exposes per-log editing sessions for integration across views.

---

## Rich Text & Markdown Editing

Documents can be authored in either a full WYSIWYG rich text editor (powered
by Tiptap) or a Markdown source editor with a live rendered preview. Users
switch between modes at any time, and their preference is saved across
sessions.

---

## Code Syntax Highlighting

Fenced code blocks support syntax highlighting for **25 languages**
(JavaScript, TypeScript, Python, Java, C, C++, Go, Rust, Ruby, PHP, SQL, HTML,
CSS, JSON, YAML, Bash, and more). A language selector dropdown is built into
each code block, with auto-detection as a fallback. Highlighting renders in
both the editor and read-only views.

---

## Draw.io Diagram Integration

Users can embed draw.io (diagrams.net) diagrams directly into documents.
Clicking the toolbar button opens the draw.io editor in a popup. Diagram XML
and a rendered SVG preview are stored inline in the document, and the diagram
can be re-opened, edited, or removed at any time via the embed API.

---

## Resizable Images

Images inserted into documents can be interactively resized using drag handles.
The width is persisted in the document HTML so the layout is preserved for all
viewers. An image crop modal with an eight-handle crop rectangle, rule-of-
thirds grid overlay, and canvas-based output is available when inserting
images.

---

## Document Image Hosting

Images pasted or dropped into the editor are automatically uploaded, processed
(resized to a maximum of 2048 px, converted to WebP at 85 % quality), and
served from a dedicated static endpoint with 30-day cache headers.
Content-hash deduplication (SHA-256) prevents storing the same image twice.
Base64 data URIs are extracted on save and re-inlined for self-contained
exports.

---

## Inline Comments & Annotations

Squad members can highlight text and attach comments anchored to specific
passages. Comments support a **tag system** (comment, suggestion, question,
issue, note) and a **status workflow** (open → resolved / dismissed). Threaded
replies enable focused discussions, and all comment activity is broadcast in
real time via WebSocket.

---

## @Mentions

Typing `@` inside the editor opens an autocomplete that surfaces squad members
the user has visibility into. Posting a document with a fresh mention does
two things automatically: it sends the mentioned user a notification (in-app
+ email if their preferences allow it) and **adds them as a watcher** on the
document so they keep getting updates without having to opt in manually.

---

## Document Watches & Subscriptions

A user can **watch** a log or an entire archive to be notified about future
activity (new comments, edits, published versions). Watches are explicit
(toggled from the document UI) or implicit (added automatically when the user
is mentioned or replies to a comment). The notification subsystem fans
activity out to all watchers, applying the 60-second coalescing window so
a flurry of edits does not produce a flurry of inbox entries.

See [notifications.md](./notifications.md) for the underlying mechanics.

---

## Notifications Inbox

A unified inbox surfaces every alert: mentions, comments on watched docs,
new versions on watched docs, squad invitations, and watched-archive activity.
Each notification persists in the database, pushes to the user's open tabs
over a dedicated WebSocket (`/notifications-ws`), and may also send an email
based on per-type preferences. A bell icon with an unread badge sits in the
top navigation bar; the full inbox is at `/notifications`.

---

## Notification Preferences

Per-type **email** opt-in/out lives at `/notifications/preferences`. Defaults
favor the alerts users typically want (mentions, comments on their docs,
watched-doc comments, watched publishes, squad invites) and disable the
chattier ones (every watched-doc edit). In-app inbox delivery is always on —
preferences only control the email channel.

---

## Workspace Activity Stream

A scrollable, filterable feed of meaningful events in a workspace: documents
created/published/restored, comments added/resolved, archive grants changed,
squad memberships moved. The feed is **access-filtered at query time** through
the same ownership SQL fragments the rest of the app uses, so a user only
sees activity on resources they can read. Backed by the `activity_log` table,
which is auto-pruned daily to a 365-day window.

---

## Workspaces & Squads

Content is organized under workspaces, each managed by a single owner. Within
a workspace, **squads** group users with role-based membership (member, admin,
owner). Squad invitations track pending, accepted, and declined states.
Granular per-member permissions control read, write, log creation, archive
creation, member management, version deletion, and publishing rights.

---

## Archives & Layered Access Control

Archives serve as top-level containers for related logs and can optionally be
scoped to a specific squad. Logs are arranged in a hierarchical parent-child
tree structure with breadcrumb navigation. Access is **layered** — the system
walks a 7-step priority cascade on every check:

```
   1.  super admin                                            ─► allow
   2.  user ID listed in archives.read_access                 ─► allow
   3.  archive creator (archives.created_by)                  ─► allow
   4.  workspace owner (squad → workspaces.owner = email)     ─► allow
   5.  squad member with role='owner' or matching can_*       ─► allow
   6.  user is in any squad listed in read_access_squads      ─► allow
   7.  read_access_workspace=TRUE and any squad in workspace  ─► allow
                                                              ─► deny
```

A collapsible access panel on each archive card displays the owner, inherited
squad members with role and permission badges, workspace-level grants,
explicitly granted squads, and individually granted users. Users whose access
is already covered by a squad or owner membership are omitted from the
individual user list to keep the display clean.

See [access-control.md](./access-control.md) for the full resolution logic.

---

## GitHub Integration

Archives can be linked to GitHub repositories for browsing, editing, and pull
request management without leaving the platform. The integration is a
**live API proxy** — no webhooks, no background sync. Features include:

- Repository search, file tree navigation, and file viewing with smart
  text-file filtering (50+ supported extensions)
- In-browser file editing with commit support (create and update files via
  the GitHub Contents API)
- Branch management (list and create branches from any ref)
- Pull request listing, creation, commits, and changed-files view
- Encrypted access token storage (AES-256-GCM derived from the client secret
  via scrypt)
- CI/check-run status surfaced inline (Actions runs, check-runs per SHA)
- Releases listing and creation

---

## GitHub PR Merge Workflow

Cloud Codex maintains a **PR session** for each pull request the team is
working in (`github_pr_sessions`). The merge dialog tracks files changed,
in-thread comments, code reviews, and the diff state across the lifetime of
the PR. Comments and reviews can be posted from inside the doc tool, with the
session linking PR conversation back to any documents tied to the touched
files.

---

## GitHub Code, Issue & PR Embeds

`/github/embed/code` and the issue search endpoints feed embedded blocks
that the editor can pin into a document (`github_embed_refs` records the
pinned `ref`/`SHA` so the embed stays stable even if the underlying file
moves). Embeds render with their current state when the document is opened —
they're not snapshots; they're live references that show pinned content with
a pointer to "see the current version on GitHub".

---

## Archive ↔ Repository Linking

An archive can be **bulk-linked** to a repository's `docs/` path. Cloud Codex
imports every supported file as a log, preserving folder structure as the
log tree. From there each imported log is individually linked back to its
source file, and the per-doc pull/push/resolve workflow keeps both sides in
sync. Refresh imports new files added since the last import; existing
linked files are left alone.

---

## OAuth & Single Sign-On

**Google Workspace SSO** enables domain-restricted login with automatic account
creation for allowed domains. **GitHub OAuth** provides account linking and
access token exchange used by the GitHub integration. Both providers support
unlinking flows with lockout prevention, and a provider detection endpoint
drives a dynamic login UI.

---

## Admin Console

A dedicated admin dashboard provides platform-wide management:

- **Statistics** — live counts of users, workspaces, squads, archives, logs,
  and pending invitations.
- **Workspace management** — create workspaces (with optional squad and
  archive scaffolding), list, and delete.
- **User management** — list all users with squad membership counts, delete
  non-admin accounts, toggle admin status, edit per-user creation
  permissions.
- **User invitations** — invite users by email (sends a branded HTML signup
  link), list pending invitations, and revoke.
- **Live presence telemetry** — see which documents are currently being
  edited and by whom.

An admin super-user is automatically synced from environment variables on
server startup.

---

## Explore & Browse Documents

A card-based browse view lists all accessible documents with sorting (newest,
oldest, title, archive), paginated results, and integrated search with
contextual match snippets and keyword highlighting. Each card shows the
archive name, author, date, word count, and live presence avatars indicating
who is currently editing.

---

## Version History

Any authorized user can publish a named version snapshot with optional
release notes (up to 5,000 characters). The version browser lets users browse,
preview, and compare historical snapshots. Previous versions can be restored
at any time, with all content re-sanitized on restoration.

---

## Document Import & Export

Logs can be created by uploading HTML, Markdown, plain text, PDF, or Word
DOCX files. All imported formats are automatically converted to sanitized
HTML. Logs can be exported as DOCX, HTML, Markdown, plain text, or PDF (via
browser print-to-PDF).

---

## Full-Text Search

Search is powered by a MySQL `FULLTEXT` index across log titles and
plain-text content. Results are scoped to logs the current user has
permission to access and are returned with paginated snippet previews.

---

## Favorites

Users can star any document to add it to their personal favorites list. A
star toggle appears in the editor header on every document. The home page
displays a dedicated favorites section above the browse view, showing the
most recently favorited documents as cards with title, archive, author, and
excerpt. Favorites are scoped per-user and persist across sessions.

---

## User Profiles & Preferences

Users can upload a profile picture (automatically resized to 256 × 256 WebP),
update their name, email, and password, and customize appearance preferences
including accent color, font size, UI density, sidebar behavior, and default
editor mode.

---

## Authentication & Two-Factor Security

Authentication uses 64-character cryptographically random session tokens with
a 7-day expiry. Password reset is handled via email-based token flow.
Two-factor authentication supports both **email OTP codes** and **TOTP
authenticator apps** (with QR code setup).

---

## Guided Onboarding

A post-signup welcome wizard walks new users through creating their first
workspace, squad, and archive in a single guided flow.
