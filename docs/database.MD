# Database

> **This file is superseded by the full schema reference at [database.md](./database.md).**

Cloud Codex uses MySQL 8 running in a Docker container. Start the container and connect:

```bash
docker compose up -d
mysql -h 127.0.0.1 -P 3306 -u <DB_USER> -p <DB_NAME>
```

See `.env.example` for the required credentials.

See [database.md](./database.md) for complete table definitions, relationships, and design notes.