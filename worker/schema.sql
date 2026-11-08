-- Andijon RP — D1 schema. Run once:
--   npx wrangler d1 execute andijon-rp-db --remote --file=./schema.sql
CREATE TABLE IF NOT EXISTS accounts (
  name         TEXT PRIMARY KEY,           -- lowercase login key
  display_name TEXT NOT NULL,              -- original-case name shown in game
  pass_hash    TEXT NOT NULL,
  pass_salt    TEXT NOT NULL,
  district     TEXT NOT NULL DEFAULT '',
  money        INTEGER NOT NULL DEFAULT 500,
  hunger       INTEGER NOT NULL DEFAULT 100,
  fuel         INTEGER NOT NULL DEFAULT 50,
  role         TEXT NOT NULL DEFAULT 'fuqaro',
  cars         TEXT NOT NULL DEFAULT '[]', -- JSON array of owned car model ids
  last_bonus   INTEGER NOT NULL DEFAULT 0, -- unix seconds, bank daily bonus
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
