CREATE TABLE IF NOT EXISTS income_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS incomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  occurred_on TEXT NOT NULL,
  amount REAL NOT NULL,
  payee TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  txn_id INTEGER,
  source TEXT NOT NULL DEFAULT '手工',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS incomes_by_user_date ON incomes(user_id, occurred_on);
CREATE INDEX IF NOT EXISTS incomes_by_txn ON incomes(user_id, txn_id);
