CREATE TABLE state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, content TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE pairings (code_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE devices (id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, name TEXT NOT NULL, tokens TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE actions (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, device_id TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(device_id,id));
CREATE TABLE outbox (id TEXT PRIMARY KEY, kind TEXT NOT NULL, device_id TEXT, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL, locked_until INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at INTEGER NOT NULL);
CREATE INDEX outbox_ready ON outbox(status,available_at,locked_until);
CREATE TABLE throttles (device_id TEXT PRIMARY KEY, last_sent INTEGER NOT NULL);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
