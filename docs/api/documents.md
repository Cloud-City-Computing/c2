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
  "parent_id": null,           // optional — nest under another log
  "html_content": "<p></p>",   // optional initial content
  "markdown_content": null     // optional
}
```

Requires the `create_log` permission (global, squad-level, or via workspace ownership).

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

**Body:** `{ title }` — max 255 characters.

---

### `PUT /api/document/:logId/parent`

Move a document to a different parent (or to the root by passing `null`). Requires write access.

**Body:** `{ parent_id: <id> | null }`

---

### `DELETE /api/document/:logId`

Delete a document and all its versions, comments, and favorites. Requires write access.

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

### `GET /api/document/:logId/export/markdown`

Export the document as a Markdown (`.md`) file download. Converts HTML to Markdown via Turndown, with embedded images inlined as base64.

---

### `GET /api/document/:logId/export/docx`

Export the document as a Word (`.docx`) file download via `html-to-docx`.

---

## Real-Time Collaboration

Collaborative editing uses **WebSockets** rather than HTTP. See [services.md](../services.md#collaborative-editing) for a full description of the WebSocket protocol and architecture.

The REST endpoints above handle content persistence; the WebSocket handles live peer-to-peer CRDT sync while a document is actively being edited.
