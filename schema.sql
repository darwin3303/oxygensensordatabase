-- O2 Sensor Inventory — database schema
-- Safe to run repeatedly: every statement is idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS brands (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sensors (
  id            TEXT PRIMARY KEY,
  brand_id      TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  sensor_number TEXT NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 0,
  box           TEXT NOT NULL DEFAULT '',
  cars          JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sensors_brand_id ON sensors(brand_id);

CREATE TABLE IF NOT EXISTS movements (
  id            TEXT PRIMARY KEY,
  sensor_id     TEXT NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  change        INTEGER NOT NULL,
  type          TEXT NOT NULL, -- 'use' | 'restock' | 'adjust'
  ts            BIGINT NOT NULL -- epoch millis, matches the frontend's Date.now()
);
CREATE INDEX IF NOT EXISTS idx_movements_sensor_id ON movements(sensor_id);
CREATE INDEX IF NOT EXISTS idx_movements_ts ON movements(ts);

CREATE TABLE IF NOT EXISTS to_buy (
  id            TEXT PRIMARY KEY,
  brand_name    TEXT NOT NULL,
  sensor_number TEXT NOT NULL,
  qty           INTEGER NOT NULL DEFAULT 1,
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS equivalent_groups (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS equivalent_members (
  id            TEXT PRIMARY KEY,
  group_id      TEXT NOT NULL REFERENCES equivalent_groups(id) ON DELETE CASCADE,
  sensor_id     TEXT REFERENCES sensors(id) ON DELETE SET NULL,
  brand_name    TEXT NOT NULL,
  part_number   TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_equiv_members_group_id ON equivalent_members(group_id);

-- Single-row settings table (garage-wide preferences).
CREATE TABLE IF NOT EXISTS settings (
  id                SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  low_stock_threshold INTEGER NOT NULL DEFAULT 2,
  fast_mover_window_days INTEGER NOT NULL DEFAULT 30,
  active_brand_id   TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Bumped on every write anywhere in the schema, via the trigger below.
-- The frontend polls this to know whether it needs to re-fetch full state.
CREATE TABLE IF NOT EXISTS sync_meta (
  id            SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version       BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO sync_meta (id, version) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
