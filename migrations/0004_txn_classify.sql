ALTER TABLE account_txns ADD COLUMN treat TEXT NOT NULL DEFAULT '';
ALTER TABLE account_txns ADD COLUMN category_id INTEGER;
ALTER TABLE expenses ADD COLUMN txn_id INTEGER;
ALTER TABLE expenses ADD COLUMN source TEXT NOT NULL DEFAULT '手工';

CREATE TABLE IF NOT EXISTS txn_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  field TEXT NOT NULL,
  keyword TEXT NOT NULL,
  treat TEXT NOT NULL,
  category_id INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, field, keyword)
);
