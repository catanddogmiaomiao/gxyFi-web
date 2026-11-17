ALTER TABLE holdings ADD COLUMN sold_on TEXT;
ALTER TABLE holdings ADD COLUMN sell_price REAL;
ALTER TABLE holdings ADD COLUMN count_invested INTEGER NOT NULL DEFAULT 0;

ALTER TABLE dca_plans ADD COLUMN sold_on TEXT;
ALTER TABLE dca_plans ADD COLUMN sell_price REAL;
ALTER TABLE dca_plans ADD COLUMN count_invested INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS liquid_days (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  invest_cny REAL NOT NULL,
  parts_json TEXT NOT NULL,
  PRIMARY KEY (user_id, day)
);
