PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS xhs_accounts (
 id TEXT PRIMARY KEY, label TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('manual','mock')),
 auth TEXT NOT NULL CHECK(auth IN ('unknown','valid','expired')), revision INTEGER NOT NULL DEFAULT 1,
 checked_at TEXT
);
CREATE TABLE IF NOT EXISTS xhs_assets (
 id TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS xhs_contents (
 id TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL, changed INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS xhs_versions (
 content_id TEXT NOT NULL REFERENCES xhs_contents(id), version INTEGER NOT NULL,
 payload TEXT NOT NULL, hash TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(content_id,version)
);
CREATE TABLE IF NOT EXISTS xhs_approvals (
 id TEXT PRIMARY KEY, content_id TEXT NOT NULL, version INTEGER NOT NULL, hash TEXT NOT NULL,
 account_id TEXT NOT NULL REFERENCES xhs_accounts(id), account_revision INTEGER NOT NULL, rules_hash TEXT,
 scheduled_at TEXT NOT NULL, timezone TEXT NOT NULL, approved_at TEXT NOT NULL, actor TEXT NOT NULL,
 FOREIGN KEY(content_id,version) REFERENCES xhs_versions(content_id,version)
);
CREATE TABLE IF NOT EXISTS xhs_jobs (
 id TEXT PRIMARY KEY, approval_id TEXT NOT NULL UNIQUE REFERENCES xhs_approvals(id),
 content_id TEXT NOT NULL REFERENCES xhs_contents(id), version INTEGER NOT NULL, mode TEXT NOT NULL,
 state TEXT NOT NULL, due_at TEXT NOT NULL, scheduled_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, checks INTEGER NOT NULL DEFAULT 0, query_failures INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT, lease_until TEXT, action TEXT, handed_at TEXT,
 cancel_requested INTEGER NOT NULL DEFAULT 0, platform_id TEXT, note_url TEXT, receipt_kind TEXT,
 reason TEXT, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS xhs_one_active_job ON xhs_jobs(content_id)
 WHERE state NOT IN ('cancelled','expired','failed','published');
CREATE INDEX IF NOT EXISTS xhs_due ON xhs_jobs(due_at,state);
CREATE TABLE IF NOT EXISTS xhs_events (
 id INTEGER PRIMARY KEY, content_id TEXT NOT NULL, job_id TEXT, at TEXT NOT NULL,
 actor TEXT NOT NULL, event TEXT NOT NULL, detail TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS xhs_mock_receipts (
 job_id TEXT PRIMARY KEY, state TEXT NOT NULL, queries INTEGER NOT NULL DEFAULT 0
);
PRAGMA user_version=1;
