# Testing

The test suite uses **Vitest** and **Supertest** with fully mocked database and email layers — no running services are required.

```bash
cd cloudcodex
npm test
```

---

## Test Coverage

**528 tests** across 17 test files:

| Test File | Tests | Scope |
| --- | --- | --- |
| `auth.test.js` | 77 | Account creation, login, 2FA, password reset, sessions |
| `comments.test.js` | 58 | Comments, replies, tags, status workflow, access control |
| `documents.test.js` | 48 | Log save, publish, versions, restore, export |
| `archives.test.js` | 50 | Archive and log tree, three-tier access control, repo linking |
| `squads.test.js` | 43 | Squad CRUD, invitations, member roles, permissions |
| `admin.test.js` | 78 | Admin console, stats, user/workspace management, invitations |
| `editorUtils.test.js` | 28 | Editor utility functions and helpers |
| `github.test.js` | 50 | GitHub API proxy, repos, files, branches, PRs |
| `favorites.test.js` | 16 | Favorite add, remove, check, list, access control |
| `workspaces.test.js` | 14 | Workspace CRUD, ownership transfer |
| `search.test.js` | 13 | Full-text search, browse, presence, pagination |
| `oauth.test.js` | 13 | Google SSO, GitHub OAuth, account linking |
| `avatars.test.js` | 12 | Upload, replace, remove, validation, authorization |
| `upload.test.js` | 9 | File import, format conversion, error handling |
| `permissions.test.js` | 8 | Permission middleware, role fallbacks |
| `doc-images.test.js` | 6 | Image upload, processing, deduplication, validation |
| `auth.test.js` (middleware) | 5 | Token validation, session refresh |

---

## Test Structure

```
tests/
├── setup.js          — Global mocks (DB, email, sharp, fs)
├── helpers.js        — Shared test fixtures
├── middleware/       — Middleware unit tests
└── routes/           — API endpoint tests
```

Global mocks in `setup.js` intercept all database queries and outbound email calls, so the suite runs entirely in-process without any external dependencies.

---

## Additional Commands

| Command | Description |
| --- | --- |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with code coverage reporting |
