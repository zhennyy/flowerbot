// База: миграции поверх старой базы (созданной старым db.js), схема Prisma = схема на проде, стартовый каталог
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const testHelpers = require('../server/test-helpers');
const { runMigrations } = require('./migrations');

// Схема в том виде, в каком её оставлял старый db.js на проде: CREATE TABLE + ALTER-ы версий 1–10
const OLD_SCHEMA_SQL = `
CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL, photo_url TEXT, badge TEXT, bg TEXT DEFAULT '#f6e3ea', in_stock INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0);
ALTER TABLE products ADD COLUMN unit TEXT;
ALTER TABLE products ADD COLUMN min_qty INTEGER NOT NULL DEFAULT 1;
CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, username TEXT, customer_name TEXT NOT NULL, phone TEXT NOT NULL,
  address TEXT NOT NULL, delivery_date TEXT NOT NULL, delivery_time TEXT NOT NULL, recipient TEXT, card_text TEXT, comment TEXT, items TEXT NOT NULL,
  total INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
ALTER TABLE orders ADD COLUMN delivery_fee INTEGER;
ALTER TABLE orders ADD COLUMN delivery_km REAL;
ALTER TABLE orders ADD COLUMN delivery_zone TEXT;
ALTER TABLE orders ADD COLUMN done_at TEXT;
ALTER TABLE orders ADD COLUMN review_asked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN rating INTEGER;
ALTER TABLE orders ADD COLUMN review_text TEXT;
CREATE TABLE reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, order_id INTEGER NOT NULL, occasion TEXT NOT NULL,
  event_date TEXT NOT NULL, remind_at TEXT NOT NULL);
CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT, username TEXT, order_id INTEGER, direction TEXT NOT NULL,
  text TEXT, photo TEXT, is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX messages_user ON messages(user_id, id);
ALTER TABLE products ADD COLUMN stock INTEGER;
ALTER TABLE products ADD COLUMN addon INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN emoji TEXT;
ALTER TABLE products ADD COLUMN sizes TEXT;
ALTER TABLE orders ADD COLUMN status_msg_id INTEGER;
ALTER TABLE orders ADD COLUMN bouquet_photo TEXT;
ALTER TABLE orders ADD COLUMN photo_status TEXT;
ALTER TABLE orders ADD COLUMN photo_sent_at TEXT;
ALTER TABLE orders ADD COLUMN photo_reminded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN payment_id TEXT;
ALTER TABLE orders ADD COLUMN payment_status TEXT;
ALTER TABLE orders ADD COLUMN paid_at TEXT;
ALTER TABLE orders ADD COLUMN pay_url TEXT;
PRAGMA user_version = 10;
`;

const columnsOf = (connection, tableName) =>
  connection
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .map((column) => `${column.name}:${column.type}:${column.notnull}:${column.dflt_value}`);
const tableNamesOf = (connection) =>
  connection
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);
const newTemporaryPath = (prefix) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), 'shop.db');

let shop;
before(async () => {
  shop = await testHelpers.start();
});

test('старая база: миграция ничего не меняет в данных, второй запуск — тоже; Prisma читает заказы, сообщения и напоминания', async () => {
  const oldDatabasePath = newTemporaryPath('flowerbot-old-');
  const oldConnection = new Database(oldDatabasePath);
  oldConnection.exec(OLD_SCHEMA_SQL);
  oldConnection
    .prepare(
      "INSERT INTO products (category, name, price, unit, min_qty, stock, sizes, sort) VALUES ('Поштучно', 'Роза', 190, 'шт', 5, 40, NULL, 100)",
    )
    .run();
  oldConnection
    .prepare(
      `INSERT INTO orders (user_id, username, customer_name, phone, address, delivery_date, delivery_time, items, total, status,
    delivery_fee, delivery_km, delivery_zone, rating, payment_id, payment_status, paid_at)
    VALUES (7392580260, 'anna', 'Анна', '+7 900', 'Невский, 1', '2026-10-01', '12:00–15:00', ?, 2380, 'done', 290, 4.2, 'Санкт-Петербург', 5, 'pay-1', 'paid', '2026-10-01 09:00:00')`,
    )
    .run(JSON.stringify([{ id: 1, name: 'Роза', price: 190, qty: 11, unit: 'шт', size: null }]));
  oldConnection
    .prepare("INSERT INTO messages (user_id, name, direction, text) VALUES (7392580260, 'Анна', 'in', 'Спасибо!')")
    .run();
  oldConnection
    .prepare(
      "INSERT INTO reminders (user_id, order_id, occasion, event_date, remind_at) VALUES (7392580260, 1, '🎂 День рождения', '2027-10-01', '2027-09-28')",
    )
    .run();
  oldConnection.prepare("INSERT INTO settings (key, value) VALUES ('photo_timeout', '45')").run();
  const dumpBefore = Object.fromEntries(
    ['products', 'orders', 'messages', 'reminders', 'settings'].map((tableName) => [
      tableName,
      oldConnection.prepare(`SELECT * FROM ${tableName}`).all(),
    ]),
  );
  oldConnection.close();

  runMigrations(oldDatabasePath);
  runMigrations(oldDatabasePath);

  const migrated = new Database(oldDatabasePath);
  assert.deepEqual(
    migrated
      .prepare('SELECT name FROM _app_migrations')
      .all()
      .map((row) => row.name),
    ['001_baseline.sql'],
  );
  for (const [tableName, rowsBefore] of Object.entries(dumpBefore))
    assert.deepEqual(migrated.prepare(`SELECT * FROM ${tableName}`).all(), rowsBefore, tableName);
  assert.equal(migrated.pragma('user_version', { simple: true }), 10);
  migrated.close();

  // Prisma поверх мигрированной старой базы — тем же адаптером, что и приложение
  const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
  const { PrismaClient } = require('./generated');
  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${oldDatabasePath}` }) });
  try {
    const order = await prisma.order.findUnique({ where: { id: 1 } });
    assert.equal(order.user_id, 7392580260);
    assert.equal(order.delivery_km, 4.2);
    assert.match(order.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.equal((await prisma.message.findFirst()).text, 'Спасибо!');
    assert.equal((await prisma.reminder.findFirst()).remind_at, '2027-09-28');
    const created = await prisma.order.create({
      data: {
        user_id: 1,
        customer_name: 'Б',
        phone: '1',
        address: 'А',
        delivery_date: '2026-10-20',
        delivery_time: '12:00–15:00',
        items: '[]',
        total: 1,
      },
    });
    assert.equal(created.id, 2);
    assert.equal(created.status, 'new');
    assert.match(
      created.created_at,
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
      'дата по умолчанию — как раньше, datetime(now)',
    );
  } finally {
    await prisma.$disconnect();
  }
});

test('новая база по миграциям совпадает со старой по таблицам и колонкам (тип, NOT NULL, значение по умолчанию)', () => {
  const oldConnection = new Database(newTemporaryPath('flowerbot-schema-'));
  oldConnection.exec(OLD_SCHEMA_SQL);
  const freshConnection = new Database(path.join(process.env.DATA_DIR, 'shop.db'), { readonly: true });
  assert.deepEqual(tableNamesOf(freshConnection), ['_app_migrations', ...tableNamesOf(oldConnection)]);
  for (const tableName of tableNamesOf(oldConnection))
    assert.deepEqual(columnsOf(freshConnection, tableName), columnsOf(oldConnection, tableName), tableName);
  oldConnection.close();
  freshConnection.close();
});

test('база очень старой версии (до v10) — понятная ошибка вместо поломанной схемы', () => {
  const ancientDatabasePath = newTemporaryPath('flowerbot-ancient-');
  const ancientConnection = new Database(ancientDatabasePath);
  ancientConnection.exec('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT); PRAGMA user_version = 4;');
  ancientConnection.close();
  assert.throws(() => runMigrations(ancientDatabasePath), /База старой версии \(4\)/);
});

test('пустая база: стартовый каталог ровно один раз — 8 букетов, 6 цветков поштучно, 5 допов', async () => {
  const { seedDatabase } = require('./seed');
  assert.equal(await shop.database.product.count(), 19);
  await seedDatabase();
  assert.equal(await shop.database.product.count(), 19);
  assert.equal(await shop.database.product.count({ where: { unit: 'шт' } }), 6);
  assert.equal(await shop.database.product.count({ where: { addon: 1 } }), 5);
  const tulips = await shop.database.product.findFirst({ where: { name: 'Весенний микс' } });
  assert.equal(tulips.price, 1890);
  assert.equal(JSON.parse(tulips.sizes)[2].note, '51 тюльпан');
});

test('транзакция: ошибка внутри откатывает всё', async () => {
  const { runInTransaction, database } = require('./index');
  await assert.rejects(
    runInTransaction(async () => {
      await database.setting.create({ data: { key: 'transaction-test', value: '1' } });
      throw new Error('сломалось');
    }),
    /сломалось/,
  );
  assert.equal(await shop.database.setting.findUnique({ where: { key: 'transaction-test' } }), null);
});
