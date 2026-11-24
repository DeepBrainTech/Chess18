CREATE TABLE IF NOT EXISTS guest_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS online_rooms (
  code CHAR(8) PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('waiting', 'playing', 'finished')),
  snapshot JSONB NOT NULL,
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS completed_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code CHAR(8) NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('classic', 'chess18')),
  white_user_id UUID NOT NULL REFERENCES guest_profiles(id),
  black_user_id UUID NOT NULL REFERENCES guest_profiles(id),
  result TEXT NOT NULL CHECK (result IN ('white', 'black', 'draw')),
  reason TEXT NOT NULL,
  starting_fen TEXT NOT NULL,
  final_fen TEXT NOT NULL,
  pgn TEXT NOT NULL,
  moves JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS completed_games_white_user_finished
  ON completed_games (white_user_id, finished_at DESC);
CREATE INDEX IF NOT EXISTS completed_games_black_user_finished
  ON completed_games (black_user_id, finished_at DESC);
CREATE INDEX IF NOT EXISTS online_rooms_expiration
  ON online_rooms (expires_at)
  WHERE expires_at IS NOT NULL;
