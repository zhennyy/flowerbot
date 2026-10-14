-- Базовая схема: таблицы «Флёра» в том виде, в каком их оставил старый db.js (версия базы 10):
-- CREATE TABLE плюс все колонки, которые добавлялись ALTER-ами, в том же порядке.
-- На уже работающей базе ничего не меняет (CREATE ... IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL,
  photo_url TEXT,
  badge TEXT,
  bg TEXT DEFAULT '#f6e3ea',
  in_stock INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  unit TEXT,
  min_qty INTEGER NOT NULL DEFAULT 1,
  stock INTEGER,
  addon INTEGER NOT NULL DEFAULT 0,
  emoji TEXT,
  sizes TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  username TEXT,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  delivery_date TEXT NOT NULL,
  delivery_time TEXT NOT NULL,
  recipient TEXT,
  card_text TEXT,
  comment TEXT,
  items TEXT NOT NULL,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivery_fee INTEGER,
  delivery_km REAL,
  delivery_zone TEXT,
  done_at TEXT,
  review_asked INTEGER NOT NULL DEFAULT 0,
  rating INTEGER,
  review_text TEXT,
  status_msg_id INTEGER,
  bouquet_photo TEXT,
  photo_status TEXT,
  photo_sent_at TEXT,
  photo_reminded INTEGER NOT NULL DEFAULT 0,
  payment_id TEXT,
  payment_status TEXT,
  paid_at TEXT,
  pay_url TEXT
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  occasion TEXT NOT NULL,
  event_date TEXT NOT NULL,
  remind_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT,
  username TEXT,
  order_id INTEGER,
  direction TEXT NOT NULL,
  text TEXT,
  photo TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS messages_user ON messages (user_id, id);

-- Номер версии, который вёл старый db.js: если вдруг откатиться на старый код, он не станет заново добавлять колонки
PRAGMA user_version = 10;
