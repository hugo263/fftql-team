-- One-use tickets from the existing TQL Draft admin. No credentials are stored here.
CREATE TABLE admin_sso_tickets (
  jti text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX admin_sso_tickets_expiry ON admin_sso_tickets (expires_at);
