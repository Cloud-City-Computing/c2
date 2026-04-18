# API Reference — Comments & Annotations

Comments attach threaded discussions to a document. Each comment is optionally anchored to a text selection range within the document content, enabling inline annotation workflows.

All routes require authentication. Read access to the parent document is required to view or post comments.

---

## Comment Tags

Comments support a `tag` to categorize their intent:

| Tag          | Purpose                           |
|--------------|-----------------------------------|
| `comment`    | General remark (default)          |
| `suggestion` | Proposed change                   |
| `question`   | Request for clarification         |
| `issue`      | Flags a problem                   |
| `note`       | Non-actionable informational note |

---

## Comment Status

Each comment has a `status` lifecycle:

| Status      | Meaning                                    |
|-------------|--------------------------------------------|
| `open`      | Active and visible (default)               |
| `resolved`  | Addressed — can be reopened                |
| `dismissed` | Closed without action                      |

---

## Endpoints

### `GET /api/logs/:logId/comments`

Fetch all comments on a document, with their replies and user info.

**Query params:** `?status=open|resolved|dismissed` — optional filter.

**Response**

```json
{
  "comments": [
    {
      "id": 1,
      "log_id": 12,
      "user_id": 3,
      "content": "This section needs more detail.",
      "tag": "suggestion",
      "status": "open",
      "selection_start": 140,
      "selection_end": 210,
      "selected_text": "the deployment process",
      "resolved_by": null,
      "resolved_at": null,
      "created_at": "...",
      "updated_at": "...",
      "user_name": "bob",
      "user_email": "bob@example.com",
      "resolved_by_name": null,
      "replies": [
        {
          "id": 5,
          "comment_id": 1,
          "user_id": 1,
          "content": "Agreed, will expand.",
          "created_at": "...",
          "user_name": "alice"
        }
      ]
    }
  ]
}
```

---

### `GET /api/logs/:logId/comments/count`

Return the count of open comments. Lightweight endpoint used for notification badges.

**Response:** `{ count: 3 }`

---

### `POST /api/logs/:logId/comments`

Create a new comment on a document.

**Body**

```json
{
  "content": "This needs clarification.",
  "tag": "question",
  "selection_start": 50,
  "selection_end": 75,
  "selected_text": "the key assumption"
}
```

`tag`, `selection_start`, `selection_end`, and `selected_text` are all optional. Maximum content length is 10,000 characters.

**Response:** `201` with the created comment object (including an empty `replies` array).

---

### `PUT /api/comments/:commentId`

Edit a comment's content or tag. **Only the original author** can edit.

**Body:** `{ content?, tag? }`

---

### `DELETE /api/comments/:commentId`

Delete a comment and all its replies. Only the author or a document write-access holder can delete.

---

### `PATCH /api/comments/:commentId/status`

Change a comment's status (resolve or dismiss).

**Body:** `{ status: 'resolved' | 'dismissed' | 'open' }`

Requires write access to the document. Sets `resolved_by` and `resolved_at` when transitioning to `resolved`.

---

### `POST /api/comments/:commentId/replies`

Add a reply to a comment. Any user with read access to the document can reply.

**Body:** `{ content }` — max 10,000 characters.

**Response:** `201` with the created reply object.

---

### `PUT /api/comments/:commentId/replies/:replyId`

Edit a reply. Author only.

**Body:** `{ content }`

---

### `DELETE /api/comments/:commentId/replies/:replyId`

Delete a reply. Author or document write-access holder.
