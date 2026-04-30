```
─── ◆ ─────────────────────────────────────────────────────────────────────
   API · Search & Favorites
─── ◆ ─────────────────────────────────────────────────────────────────────
```

# API Reference — Search & Favorites

## Search

Full-text search across all documents the current user has read access to. Built on MySQL's `FULLTEXT` index over the `logs.title` and `logs.plain_content` columns.

---

### `GET /api/search`

Search documents by keyword query.

**Query Parameters**

| Param         | Type    | Default | Description                                       |
|---------------|---------|---------|---------------------------------------------------|
| `query`       | string  | —       | Search term (required). Max 100 characters.       |
| `page`        | number  | 1       | Page number                                       |
| `limit`       | number  | 10      | Results per page (max 48)                         |
| `favorites`   | boolean | —       | Filter to favorited documents only (`true`/`1`)   |
| `workspaceId` | number  | —       | Filter to documents within a specific workspace   |
| `squadId`     | number  | —       | Filter to a specific squad's archives             |
| `archiveId`   | number  | —       | Filter to a specific archive                      |

**Response**

```json
{
  "results": [
    {
      "id": 42,
      "title": "API Authentication Guide",
      "created_at": "...",
      "archive_id": 5,
      "author": "alice",
      "archive_name": "Platform API",
      "char_count": 1820,
      "excerpt": "Plain text excerpt (200 chars)...",
      "snippet": "...context around the match...",
      "matchStart": 15,
      "matchEnd": 25,
      "matchedOn": "content"
    }
  ],
  "total": 48,
  "page": 1,
  "totalPages": 5
}
```

`snippet` is a 160-character window of context around the first match occurrence in the document body. `matchStart` and `matchEnd` are offsets within the snippet string for the client to highlight.

`matchedOn` is either `"title"` or `"content"`, indicating where the match was found.

**Search algorithm**

- Queries ≥ 3 characters use MySQL boolean-mode `FULLTEXT` search with prefix-matching (e.g. `auth` matches `authentication`).
- Queries shorter than 3 characters fall back to `LIKE %term%` pattern matching.
- Results are ordered by relevance score (FULLTEXT) then creation date descending.
- Boolean operators entered by the user (like `+`, `-`, `"`) are stripped before being passed to MySQL to prevent injection of search operators.

---

### `GET /api/browse`

Browse/list documents without a keyword — supports the same filters as `/api/search` but returns documents sorted by recency rather than relevance. Useful for showing "recent documents" or filtered archive views.

**Query Parameters:** Same filter params as `/api/search` (`page`, `limit`, `favorites`, `workspaceId`, `squadId`, `archiveId`).

---

## Live Presence in Search

Documents that are currently being actively edited by other users include a `presence` array in the response, showing the users connected to that document's WebSocket session. This data comes from the in-memory collaborative editing service.

---

## Favorites

Favorites let users bookmark frequently accessed documents for quick retrieval. Access to a favorited document is still validated on retrieval — if access is later revoked, the document will not appear in the favorites list even if the bookmark record still exists.

---

### `GET /api/favorites`

List the current user's favorited documents, paginated.

**Query Params:** `?page=1&limit=12` (max 48 per page)

**Response**

```json
{
  "success": true,
  "results": [
    {
      "id": 12,
      "title": "Incident Runbook",
      "created_at": "...",
      "archive_id": 7,
      "author": "dave",
      "archive_name": "Ops Runbooks",
      "excerpt": "First 200 chars...",
      "char_count": 3400,
      "favorited_at": "..."
    }
  ],
  "total": 5,
  "page": 1,
  "totalPages": 1
}
```

---

### `GET /api/favorites/check?logId=<id>`

Check whether the current user has bookmarked a specific document.

**Response:** `{ success: true, favorited: true }`

---

### `POST /api/favorites`

Add a document to favorites.

**Body:** `{ logId }`

Requires read access to the document. Returns `409` if already favorited.

---

### `DELETE /api/favorites/:logId`

Remove a document from favorites.
