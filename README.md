<p align="center">
  <img src="cloudcodex/src/assets/ccc_brand/ccc_no_txt_transparent.png" alt="Cloud Codex" width="120" />
</p>

```
            ____ _                 _    ____          _
           / ___| | ___  _   _  __| |  / ___|___   __| | _____  __
          | |   | |/ _ \| | | |/ _` | | |   / _ \ / _` |/ _ \ \/ /
          | |___| | (_) | |_| | (_| | | |___| (_) | (_| |  __/>  <
           \____|_|\___/ \__,_|\__,_|  \____\___/ \__,_|\___/_/\_\
```

<h3 align="center">Real-time team docs that you actually own.</h3>

<p align="center">
  A self-hosted, real-time collaborative documentation platform by
  <a href="https://cloudcitycomputing.com">Cloud City Computing, LLC</a>
</p>

<p align="center">
  <img alt="CI" src="https://img.shields.io/github/actions/workflow/status/RhykerWells/c2/ci.yml?branch=main&label=CI" />
  <img alt="Tests" src="https://img.shields.io/badge/tests-1128%20passing-brightgreen" />
  <img alt="Coverage (lines)" src="https://img.shields.io/badge/coverage%20(lines)-46%25-yellow" />
  <img alt="Node" src="https://img.shields.io/badge/node-20.x-339933" />
  <img alt="License" src="https://img.shields.io/badge/license-source--available-blue" />
</p>

> **A self-hosted Confluence/Notion alternative built on real CRDT
> collaboration, with GitHub as a first-class surface — not a plugin.**
> Multiple users edit the same document at the same time with conflict-free
> merging, browse and edit a linked GitHub repo without leaving the page,
> and run the whole stack on one box with one Node container and one MySQL
> container.

---

## Why Cloud Codex

**True real-time editing, not last-write-wins.** Every doc is a Yjs
CRDT. Two people typing in the same paragraph see each other's cursors,
and the merge is automatic — there's no "your version overwrote mine"
moment. The same WebSocket carries comments and presence, so the doc
feels alive while you work in it.

**GitHub built in, not bolted on.** Browse a repo's file tree, edit
files in-browser with proper commits, open and review pull requests,
embed code or issues directly into a doc, and link a doc to a GitHub
file for two-way push/pull sync. No webhooks, no background sync — every
GitHub call is live, scoped to the user's own OAuth token (encrypted at
rest with AES-256-GCM).

**Layered access that composes.** Workspaces own squads, squads own
archives, archives own documents. Permissions cascade through a 7-step
resolution that runs in one SQL fragment — admin → archive grants →
creator → workspace owner → squad role → squad grants → workspace flag.
Share a single doc with one person, a whole squad, or every member of
the workspace, without restructuring your org.

**Self-host on one box.** One Node process runs the API, both
WebSocket servers, and the prod-built frontend. One MySQL container
holds the data. No message broker, no Redis, no Elasticsearch, no
external job queue. `docker compose up -d` and you're running.

---

## How it compares

|                                                | Cloud Codex | Notion       | Confluence    | Outline       |
|------------------------------------------------|-------------|--------------|---------------|---------------|
| Self-hosted, no SaaS dependency                | ✓           | ✗            | self-host paid | ✓            |
| True real-time CRDT collaboration              | ✓           | ✓            | ✗             | partial       |
| GitHub repo browse + in-browser edit + PR      | ✓           | ✗            | plugin        | ✗             |
| Inline code/issue embeds with pinned refs      | ✓           | partial      | ✗             | ✗             |
| Inline comments with tags + status workflow    | ✓           | partial      | ✓             | partial       |
| Invite-only registration by default            | ✓           | mixed        | ✓             | ✓             |
| Single Docker bring-up                         | ✓           | n/a          | ✗             | ✓             |
| Source-available, view & modify the code       | ✓           | ✗            | ✗             | ✓             |

Honest framing: Cloud Codex is opinionated and lean. If you need a
public-facing wiki, anonymous read access, or SSO beyond Google
Workspace domain-restriction, this isn't for you. If you want a
self-hosted spot for a working team to actually write together, it
probably is.

---

## Highlights

```
   ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
   ┃                       CLOUD  CODEX                              ┃
   ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
                                   │
   ┌───────────┬──────────────┬────┴──────┬───────────┬────────────────┐
   │           │              │           │           │                │
 real-time   GitHub        layered     comments  notifications     self-host
   CRDT     1st-class      access       tagged    coalesced        in one box
 cursors +   repo edit +   7-step    + threaded   inbox + email   single Node
 presence    PRs + embeds  cascade    + status    opt-in per type process
```

- **Edit together, conflict-free** — Yjs CRDT, remote cursors, live
  presence avatars, doc-keyed WebSocket
- **GitHub, not bolted on** — repo tree, in-browser edit, branch + PR
  management, code/issue/PR embeds, doc↔file sync, CI status inline
- **Layered access that composes** — 7-step resolution at the SQL
  fragment level, no per-step round trips
- **Talk back to the doc** — text-anchored comments with tags
  (comment / suggestion / question / issue / note) and status workflow
  (open → resolved / dismissed), threaded replies, real-time WS
  broadcast
- **Notifications that don't spam** — 60-second coalescing window,
  per-type email opt-in/out, push-only `/notifications-ws` channel,
  defaults that favor signal over noise
- **Own your destiny** — invite-only, no telemetry, no third-party
  services in the request path, source-available, runs on your box

→ Full feature reference in [docs/features.md](docs/features.md).

---

## Architecture at a glance

```
   ┌────────────────────────────────────────────────────────────────┐
   │                  Browser (single-page app)                     │
   │     React 19 + Tiptap + Yjs · bundled by Vite                  │
   └─────────┬─────────────────┬─────────────────┬─────────────────┘
             │ HTTP / JSON     │ WS /collab      │ WS /notifications-ws
             │                 │                 │
   ┌─────────▼─────────────────▼─────────────────▼─────────────────┐
   │                 Node.js  (single process)                      │
   │     Express + 18 routers · 2 WebSocket servers                 │
   │     Notifications funnel · Yjs CRDT sync · GitHub proxy        │
   └──────────────────────────┬─────────────────────────────────────┘
                              │ mysql2 pool (10)
   ┌──────────────────────────▼─────────────────────────────────────┐
   │                       MySQL 8  (Docker)                         │
   │     25 tables · FULLTEXT search · activity log auto-prune       │
   └────────────────────────────────────────────────────────────────┘
```

→ Full system design and decisions in [docs/architecture.md](docs/architecture.md).

---

## Quick start

```bash
git clone <repository-url>
cd c2
cp .env.example .env   # fill in DB, SMTP, and admin credentials
./start.sh             # installs deps, starts MySQL, launches dev server
```

The application will be available at **http://localhost:3000**.

→ Full setup in [docs/getting-started.md](docs/getting-started.md).

---

## Documentation

Start with these and the rest flows from there:

- **[Getting Started](docs/getting-started.md)** — local setup, env vars,
  scripts, seed data
- **[Architecture](docs/architecture.md)** — system design, project
  structure, full tech stack
- **[Features](docs/features.md)** — every major capability
- **[Security](docs/security.md)** — defense-in-depth model
- **[Full doc index](docs/README.md)** — every reference, every API doc

---

## Roadmap

Roadmap and known issues live in **GitHub Issues** — see open
[issues](https://github.com/RhykerWells/c2/issues) and milestones.

---

## Contributing

Contributions are welcome. The bar is low: read
[CONTRIBUTING.md](CONTRIBUTING.md), match the existing style, lint and
test must pass, and the change should explain its **why** in the PR
description. See [CLAUDE.md](CLAUDE.md) for the long-form conventions
that govern this codebase.

---

## Security

Please report vulnerabilities privately. See [SECURITY.md](SECURITY.md)
for the disclosure policy and contact address. Don't open a public
issue for an unfixed vulnerability.

---

## License

Cloud Codex is released under a **source-available license**. You may
view, modify, and self-host the software for personal, educational, or
internal business use at no cost. Commercial use as a hosted service
requires a separate license from
[Cloud City Computing, LLC](https://cloudcitycomputing.com).

See [LICENSE](LICENSE) for full terms.
