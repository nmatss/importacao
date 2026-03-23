CREATE TABLE IF NOT EXISTS process_events (
  id SERIAL PRIMARY KEY,
  process_id INTEGER NOT NULL REFERENCES import_processes(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  metadata JSONB,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS process_events_process_id_idx ON process_events(process_id);
CREATE INDEX IF NOT EXISTS process_events_created_at_idx ON process_events(process_id, created_at DESC);
