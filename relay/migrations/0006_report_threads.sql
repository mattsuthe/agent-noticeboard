CREATE TABLE report_threads (
 id TEXT PRIMARY KEY, device_id TEXT NOT NULL, page_id TEXT NOT NULL,
 page_updated_at TEXT NOT NULL, agent_id TEXT, snapshot TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(device_id,page_id,page_updated_at)
);
CREATE TABLE thread_messages (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, thread_id TEXT NOT NULL REFERENCES report_threads(id),
 role TEXT NOT NULL CHECK(role IN ('user','agent')), text TEXT NOT NULL,
 created_at TEXT NOT NULL, received_at TEXT, reply_to TEXT REFERENCES thread_messages(id)
);
CREATE INDEX thread_messages_order ON thread_messages(thread_id,seq);
CREATE INDEX report_threads_device ON report_threads(device_id,page_id,page_updated_at);
