```
─── ◆ ─────────────────────────────────────────────────────────────────────
   API · Documents (Logs)
─── ◆ ─────────────────────────────────────────────────────────────────────
```

# API Reference — Documents (Logs)

Documents are called **logs** in the data model and API. They live inside an archive, can be nested into a tree via `parent_id`, support real-time collaborative editing via WebSocket, and have a formal version history.

All routes require authentication. Read/write access is evaluated against the parent archive's access control rules.

---

## Reading Documents

---

### `GET /api/document?doc_id=<id>`

Fetch a single document's full content.

**Response**

```json
{
  "document": {
    "id": 12,
    "title": "Getting Started",
    "html_content": "<p>...</p>",
    "markdown_content": "...",
    "created_at": "...",
    "updated_at": "...",
    "version": 3,
    "archive_id": 5,
    "name": "alice",           // author username
    "archive_name": "Docs",
    "gh_owner": "myorg",       // null if no GitHub link
    "gh_repo": "myrepo",
    "gh_path": "docs/guide.md",
    "gh_branch": "main"
  }
}
```

Returns `404` if not found or the user does not have read access.

---

### `GET /api/documents/state?workspaceId=<id>&ids=<id,id,...>`

The reconciliation read: which of these documents the caller can read in one workspace, and their
current title and archive. Cloud Command calls it to repair what the outbound event stream missed.
It accepts a session token or, when the install configures one, the service token
(`Authorization: Bearer <SERVICE_TOKEN>`); it is one of the three routes a service token reaches.

| Param | Description |
|---|---|
| `workspaceId` | Required. The workspace to answer about. |
| `ids` | Required. 1 to 100 comma-separated document ids. |

**Response**

```json
{
  "success": true,
  "documents": [
    { "id": 113, "title": "Release checklist", "archive_id": 29, "updated_at": "2026-09-24T15:04:05.000Z" }
  ]
}
```

A document appears only when the caller can read it, it lives in that workspace, and its archive is
not a system archive. Every other id, deleted, unreadable, in another workspace or never existing,
is simply absent, and the answer does not say which. `title` is bounded to 255 characters, the same
bound the outbound event envelope applies. Ordered by `id`.

Returns `400` with `A workspaceId is required` or `Between 1 and 100 document ids are required`.
Rate-limited to 120 requests per 15 minutes per client address, counted before authentication, and
every caller at one address shares that budget. A `429` means retry later: it says nothing about
which documents exist or are readable, and only an id missing from a `200` answer is absent.

---

## Creating Documents

---

### `POST /api/archives/:archiveId/logs`

Create a new document inside an archive.

**Body**

```json
{
  "title": "New Document",
  "parent_id": null,           // optional, nest under another log in this archive
  "html_content": "<p></p>",   // optional initial content
  "markdown_content": null     // optional
}
```

Requires the `create_log` permission (global, squad-level, or via workspace ownership).
A `parent_id` must be a log in the same archive; otherwise `400`
(`parent_id must be a log in this archive`). The upload route,
`POST /api/archives/:archiveId/logs/upload`, applies the same rule to its
`parent_id` field.

**Response:** `{ success: true, logId }`

---

## Saving (Autosave)

---

### `POST /api/save-document`

Save the current content of a document. This is an autosave operation — it **does not** create a version snapshot. Use the publish endpoint to create a named, versioned snapshot.

**Body**

```json
{
  "doc_id": 12,
  "html_content": "<p>Updated content</p>",
  "markdown_content": null   // pass null when editing in rich-text mode
}
```

Max content size: **2 MB**. HTML is sanitized server-side via DOMPurify before storage. Base64-embedded images are automatically extracted to disk and replaced with served URLs.

When `markdown_content` is a string, it is saved alongside the HTML (markdown-source workflows). When it is `null`, that field is cleared to indicate the document is now HTML-canonical.

---

## Updating Metadata

---

### `PUT /api/document/:logId/title`

Update a document's title. Requires write access.

**Body:** `{ title }`, a non-blank string of at most 255 characters after trimming; otherwise `400`.

Records a `log.rename` activity event.

---

### `PUT /api/archives/:archiveId/logs/:logId`

Rename a document, move it under another parent, or both. Requires write
access to the archive, and the document must be in that archive (`404`
otherwise).

**Body:** `{ title?, parent_id? }`, at least one. `title` follows the rules of
`PUT /api/document/:logId/title`: required when present, trimmed, at most 255
characters, with the same `400` bodies. `parent_id` is a log id or `null` for
the top of the tree. A new parent must be another log in the same archive and
must not be the document itself or one of its descendants; otherwise `400`.

A changed title records `log.rename`, and a changed parent records `log.move`
with `title`, `parent_id` and `previous_parent_id` in its metadata. Sending the
values already stored records nothing. Neither event notifies watchers. This
is the only route that moves a document. Moves in one archive are applied one
at a time.

---

### `DELETE /api/archives/:archiveId/logs/:logId`

Delete a document. Requires write access to the archive. Its versions,
comments, favorites and GitHub links go with it; its child documents move to
the top of the tree (`logs.parent_id` is `ON DELETE SET NULL`). Records a
`log.delete` activity event.

---

## Version Control

Documents have a `version` counter (starting at 0) that increments each time a formal snapshot is published.

---

### `POST /api/document/:logId/publish`

Publish the current document content as a new version snapshot.

**Body (optional)**

```json
{
  "title": "v2 – Revised intro",   // up to 255 chars
  "notes": "Rewrote the intro..."   // up to 5000 chars
}
```

Requires write access to the archive **and** the `can_publish` permission (or workspace/squad ownership, or being the archive creator). See [Access Control](../access-control.md).

**Response:** `{ success: true, version: 4 }`

---

### `GET /api/document/:logId/versions`

List all published versions for a document, newest first.

**Response**

```json
{
  "success": true,
  "versions": [
    {
      "id": 9,
      "version_number": 3,
      "title": "v3 release",
      "notes": "Fixed typos",
      "saved_at": "...",
      "created_by_id": 1,
      "created_by": "alice"
    }
  ]
}
```

---

### `GET /api/document/:logId/versions/:versionId`

Get the full HTML content of a specific version snapshot.

**Response:** Adds `html_content` to the version object above.

---

### `DELETE /api/document/:logId/versions/:versionId`

Delete a version snapshot. Requires the `can_delete_version` squad permission or ownership.

---

## Export

---

### `GET /api/document/:logId/export?format=<html|md|txt|docx>`

Export the document as a file download: `html` (a standalone page), `md`
(Markdown via Turndown), `txt` (tags stripped) or `docx` (via `html-to-docx`).
Requires read access; `404` otherwise. `html`, `md` and `docx` inline the
document's images as base64, **only the images the caller may see** (see
Images below); any other image reference is left as its URL.

---

## Images

---

### `POST /api/doc-images/upload`

Multipart form: `logId` (the document the images go into) and `files`
(1 to 10 images, JPEG, PNG, WebP, GIF or BMP, 10 MB each). Requires write
access to `logId`.

Each image is resized to fit 2048 px, converted to WebP, named by its content
hash, and recorded against `logId` as the caller's upload, so the document's
readers can see it at once.

**Response:** `{ success: true, urls: ["/doc-images/<hash>.webp"], data: { files, isImages, baseurl } }`

**Errors:** `400` no files, or `Invalid or missing logId`; `403` `Document not
found or write access denied` (nothing is processed); `422` no image could be
processed.

---

### `GET /doc-images/<hash>.webp`

Not under `/api`. Serves a stored image as `image/webp` with
`Cache-Control: private, max-age=86400` to its uploader and to anyone who can
read a document that holds it, authenticated by the session cookie (as an
`<img>` sends it) or a Bearer token. Every other request, including an
anonymous one, gets the same empty `404` with `Cache-Control: no-store`.
`DOC_IMAGES_PUBLIC=1` serves every image to anyone instead.

---

## Real-Time Collaboration

Collaborative editing uses **WebSockets** rather than HTTP. See [services.md](../services.md#collaborative-editing) for a full description of the WebSocket protocol and architecture.

The REST endpoints above handle content persistence; the WebSocket handles live peer-to-peer CRDT sync while a document is actively being edited.
