CREATE TABLE IF NOT EXISTS auth_throttle (
  bucket TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  institution TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT '活期',
  currency TEXT NOT NULL DEFAULT 'CNY',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS balance_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  account_id INTEGER NOT NULL,
  as_of_date TEXT NOT NULL,
  balance REAL NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (user_id, account_id, as_of_date)
);

CREATE TABLE IF NOT EXISTS holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  market TEXT NOT NULL,
  quantity REAL NOT NULL,
  currency TEXT NOT NULL,
  avg_cost REAL,
  manual_price REAL,
  account_label TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quotes (
  user_id TEXT NOT NULL,
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  price REAL,
  prev_close REAL,
  currency TEXT NOT NULL DEFAULT '',
  quoted_at TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  fetched_at TEXT NOT NULL,
  ok INTEGER NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, market, symbol)
);

CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '住宅',
  city TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  area_sqm REAL,
  acquired_on TEXT,
  purchase_price REAL,
  current_value REAL,
  valued_on TEXT,
  mortgage_balance REAL NOT NULL DEFAULT 0,
  monthly_rent REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expense_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  occurred_on TEXT NOT NULL,
  amount REAL NOT NULL,
  payee TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  UNIQUE (user_id, year, category_id)
);

CREATE TABLE IF NOT EXISTS fx_rates (
  user_id TEXT NOT NULL,
  code TEXT NOT NULL,
  rate REAL,
  source TEXT NOT NULL DEFAULT '',
  quoted_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, code)
);
