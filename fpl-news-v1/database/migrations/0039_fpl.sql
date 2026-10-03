-- Official FPL observations. Stable player codes survive differing Classic/Draft ids.
CREATE TABLE fpl_players (
  code bigint PRIMARY KEY,
  classic_id integer NOT NULL,
  season text NOT NULL,
  name text NOT NULL,
  full_name text NOT NULL,
  team text NOT NULL,
  position text NOT NULL,
  cost integer NOT NULL CHECK (cost BETWEEN 0 AND 300),
  season_delta integer NOT NULL,
  status text NOT NULL,
  chance integer,
  news text NOT NULL,
  news_added timestamptz,
  checked_at timestamptz NOT NULL
);
CREATE TABLE fpl_observations (
  id bigserial PRIMARY KEY,
  season text NOT NULL,
  checked_at timestamptz NOT NULL UNIQUE,
  prices jsonb NOT NULL,
  gameweek integer,
  next_deadline timestamptz
);
CREATE TABLE fpl_price_changes (
  id bigserial PRIMARY KEY,
  observation_id bigint NOT NULL REFERENCES fpl_observations(id),
  season text NOT NULL,
  player_code bigint NOT NULL,
  name text NOT NULL,
  team text NOT NULL,
  position text NOT NULL,
  old_cost integer NOT NULL,
  new_cost integer NOT NULL,
  previous_checked_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  gameweek integer,
  UNIQUE (observation_id, player_code),
  CHECK (old_cost <> new_cost)
);
CREATE INDEX fpl_price_changes_recent ON fpl_price_changes(observed_at DESC, id DESC);
CREATE INDEX fpl_observations_recent ON fpl_observations(checked_at DESC);
