ALTER TABLE accounts ADD COLUMN import_map TEXT NOT NULL DEFAULT '';
ALTER TABLE balance_entries ADD COLUMN source TEXT NOT NULL DEFAULT '手工';

CREATE TABLE IF NOT EXISTS account_txns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  account_id INTEGER NOT NULL,
  txn_date TEXT NOT NULL,
  txn_time TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL,
  balance REAL,
  counterparty TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  fingerprint TEXT NOT NULL,
  batch TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, account_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS account_txns_by_account ON account_txns(user_id, account_id, txn_date);
