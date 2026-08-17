CREATE TABLE IF NOT EXISTS task_parties (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  party_kind VARCHAR(16) NOT NULL CHECK (party_kind IN ('company', 'contact')),
  party_id INTEGER NOT NULL,
  role VARCHAR(40) NOT NULL DEFAULT 'related',
  PRIMARY KEY (task_id, party_kind, party_id)
);

CREATE INDEX IF NOT EXISTS idx_task_parties_party
  ON task_parties (party_kind, party_id);
