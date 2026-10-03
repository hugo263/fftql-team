-- Private adapter tests: bounded extracted samples, never public articles or model jobs.
CREATE TABLE source_tests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id text NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  actor text NOT NULL,
  config_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX source_tests_latest ON source_tests(source_id, created_at DESC);
