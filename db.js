// База данных магазина (SQLite). Файл shop.db создаётся сам при первом запуске.
const path = require('path');
const Database = require('better-sqlite3');

// На Railway база будет лежать на диске /data (как в RadiatorPro), локально — в папке проекта
// На Railway всё храним на диске /data (переменная DATA_DIR), локально — в папке проекта
const DB_PATH = process.env.DB_PATH || path.join(process.env.DATA_DIR || __dirname, 'shop.db');
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category    TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    price       INTEGER NOT NULL,           -- в рублях
    photo_url   TEXT,
    badge       TEXT,                       -- «Хит», «Новинка» или пусто
    bg          TEXT    DEFAULT '#f6e3ea',  -- цвет фона под фото, пока грузится
    in_stock    INTEGER NOT NULL DEFAULT 1, -- 1 = есть, 0 = скрыть из витрины
    sort        INTEGER NOT NULL DEFAULT 0  -- порядок в каталоге
  )
`);

// Стартовый ассортимент — добавляется только если таблица пустая
const count = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
if (count === 0) {
  const insert = db.prepare(`INSERT INTO products (category, name, description, price, photo_url, badge, bg, sort)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const seed = [
    ['Букеты',    'Утро в Провансе',            'Лаванда, кустовая роза и эвкалипт', 3490, 'https://d8j0ntlcm91z4.cloudfront.net/user_3HReZJSR0X0kuSZvadzwtcMlq6H/hf_20260930_105120_0db73747-c724-451e-9b45-d5226df7b11e_min.webp', 'Хит',     '#e9e0f3', 1],
    ['Розы',      '51 красная роза',            'Классика 60 см, в крафте',          7990, 'https://d8j0ntlcm91z4.cloudfront.net/user_3HReZJSR0X0kuSZvadzwtcMlq6H/hf_20260930_105122_0e80c362-c556-474f-b167-e3c2a035ea27_min.webp', null,      '#f7dfe3', 2],
    ['Тюльпаны',  'Весенний микс',              '25 тюльпанов пастельных оттенков',  2890, 'https://d8j0ntlcm91z4.cloudfront.net/user_3HReZJSR0X0kuSZvadzwtcMlq6H/hf_20260930_105120_d151b758-d7a9-4bb9-8cdb-42f8af8360c9_min.webp', 'Новинка', '#fbe6ec', 3],
    ['В коробке', 'Шляпная коробка «Нежность»', 'Пионовидные розы и гортензия',      4590, 'https://d8j0ntlcm91z4.cloudfront.net/user_3HReZJSR0X0kuSZvadzwtcMlq6H/hf_20260930_105120_f37b613f-1a8d-4969-b4a7-03669d56966f_min.webp', null,      '#f3e6dc', 4],
    ['Букеты',    'Полевой',                    'Ромашки, васильки, злаки',          2190, 'https://d8j0ntlcm91z4.cloudfront.net/user_3HReZJSR0X0kuSZvadzwtcMlq6H/hf_20260930_105120_ab07feb0-0329-4fca-96a3-98c517fdfa7f_min.webp', null,      '#f5f0d8', 5],
    ['Комнатные', 'Орхидея фаленопсис',         'Белая, 2 ствола, в керамике',       3290, 'https://d8j0ntlcm91z4.cloudfront.net/user_3HReZJSR0X0kuSZvadzwtcMlq6H/hf_20260930_105122_4a1116b8-a0e5-42d2-a5e2-24c6a9f388fc_min.webp', null,      '#e3efe4', 6],
    ['Розы',      'Кустовая пудровая',          '15 веток, лента в тон',             3990, 'https://d8j0ntlcm91z4.cloudfront.net/user_3HReZJSR0X0kuSZvadzwtcMlq6H/hf_20260930_105121_205f729e-9a0e-425f-ac41-3066ef28a855_min.webp', null,      '#f9e4e8', 7],
    ['В коробке', 'Коробка с макарунами',       'Розы + 6 макарун ручной работы',    5290, 'https://d8j0ntlcm91z4.cloudfront.net/user_3HReZJSR0X0kuSZvadzwtcMlq6H/hf_20260930_105121_571b8a8d-e475-431f-a42e-3a7f32ceaba9_min.webp', null,      '#efe3f0', 8],
  ];
  const insertAll = db.transaction((rows) => rows.forEach((r) => insert.run(...r)));
  insertAll(seed);
  console.log('🌱 База создана, добавлено букетов:', seed.length);
}

// ─── Обновления базы (миграции) ──────────────────────────
// PRAGMA user_version — номер версии базы. Каждое обновление выполняется ровно один раз,
// поэтому удалённые тобой товары не «воскреснут» после перезапуска.
const version = db.pragma('user_version', { simple: true });

if (version < 1) {
  // v1: поштучная продажа — единица измерения и минимальное количество
  db.exec(`
    ALTER TABLE products ADD COLUMN unit    TEXT;                        -- NULL = готовый букет, 'шт' = поштучно
    ALTER TABLE products ADD COLUMN min_qty INTEGER NOT NULL DEFAULT 1;  -- минимум в заказе
  `);
  const add = db.prepare(`INSERT INTO products (category, name, description, price, photo_url, badge, bg, unit, min_qty, sort)
                          VALUES (?, ?, ?, ?, ?, ?, ?, 'шт', ?, ?)`);
  const IMG = 'https://d8j0ntlcm91z4.cloudfront.net/user_3HReZJSR0X0kuSZvadzwtcMlq6H/hf_20260930_'; // фото из Higgsfield
  [
    ['Поштучно', 'Роза красная, 60 см',     'Эквадор, крупный бутон. Соберём в букет по вашему количеству', 190, IMG + '151740_e7dbaf90-2d2e-47b4-a053-8eb39a787509_min.webp', 'Хит', '#f7dfe3', 5],
    ['Поштучно', 'Роза белая, 60 см',       'Эквадор, чистый белый. Отлично смотрится в миксе с красной',     190, IMG + '151741_dddd6e21-25b3-4ff2-8d69-0cddb8f6c4f7_min.webp', null,  '#f3e6dc', 5],
    ['Поштучно', 'Роза пионовидная',        'Пышная, ароматная, нежно-розовая',                                390, IMG + '151740_823907a8-4f4f-4a71-8ee9-b926b6ed088a_min.webp', null,  '#f9e4e8', 3],
    ['Поштучно', 'Хризантема одноголовая',  'Белая, крупный цветок, стоит до 3 недель',                        220, IMG + '151740_3794c6f3-0eb7-448f-9884-5a38e1cce683_min.webp', null,  '#e3efe4', 3],
    ['Поштучно', 'Хризантема кустовая',     'Ветка с 8–10 сиреневыми цветками',                                250, IMG + '151740_2c2402c6-06e4-4d56-b790-c7766f04774c_min.webp', null,  '#e9e0f3', 3],
    ['Поштучно', 'Хризантема Сантини',      'Ветка с зелёными помпончиками — для акцента в букете',           170, IMG + '151742_0b757b7a-aa1f-42a2-a4ed-60fbf192a0a0_min.webp', 'Новинка', '#f5f0d8', 3],
  ].forEach(([cat, name, desc, price, img, badge, bg, min], i) =>
    add.run(cat, name, desc, price, img, badge, bg, min, 100 + i));
  db.pragma('user_version = 1');
  console.log('🌹 База обновлена: добавлены розы и хризантемы поштучно');
}

// ─── Заказы ──────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,         -- Telegram ID покупателя (чтобы писать ему)
    username      TEXT,
    customer_name TEXT    NOT NULL,
    phone         TEXT    NOT NULL,
    address       TEXT    NOT NULL,
    delivery_date TEXT    NOT NULL,         -- 2026-10-01
    delivery_time TEXT    NOT NULL,         -- «12:00–15:00»
    recipient     TEXT,                     -- если дарят кому-то другому
    card_text     TEXT,                     -- текст открытки
    comment       TEXT,
    items         TEXT    NOT NULL,         -- JSON: [{id, name, price, qty}]
    total         INTEGER NOT NULL,
    status        TEXT    NOT NULL DEFAULT 'new',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);

// Статусы заказа и как они звучат для людей
const STATUSES = {
  new:        '🆕 Новый',
  confirmed:  '✅ Подтверждён',
  assembling: '💐 Собираем букет',
  delivering: '🚚 В пути',
  done:       '🌷 Доставлен',
  cancelled:  '❌ Отменён',
};

// ─── Настройки магазина (ключ → JSON) ───────────────────
db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
const getSetting = (key, fallback) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
};
const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));

if (db.pragma('user_version', { simple: true }) < 2) {
  // v2: платная доставка — в заказе храним стоимость доставки, расстояние и зону
  db.exec(`
    ALTER TABLE orders ADD COLUMN delivery_fee  INTEGER;   -- NULL = стоимость уточним вручную
    ALTER TABLE orders ADD COLUMN delivery_km   REAL;
    ALTER TABLE orders ADD COLUMN delivery_zone TEXT;      -- «Санкт-Петербург» / «Ленобласть»
  `);
  db.pragma('user_version = 2');
}

if (db.pragma('user_version', { simple: true }) < 3) {
  // v3: отзывы после доставки и напоминания о поводах
  db.exec(`
    ALTER TABLE orders ADD COLUMN done_at      TEXT;               -- когда доставили
    ALTER TABLE orders ADD COLUMN review_asked INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE orders ADD COLUMN rating       INTEGER;            -- 1–5 ⭐
    ALTER TABLE orders ADD COLUMN review_text  TEXT;
    CREATE TABLE IF NOT EXISTS reminders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      order_id   INTEGER NOT NULL,
      occasion   TEXT    NOT NULL,     -- «День рождения», «Годовщина»…
      event_date TEXT    NOT NULL,     -- дата повода (следующая)
      remind_at  TEXT    NOT NULL      -- когда напомнить (за 3 дня)
    );
  `);
  db.pragma('user_version = 3');
}

if (db.pragma('user_version', { simple: true }) < 4) {
  // v4: переписка с покупателями (вкладка «Чаты» в админке)
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,          -- покупатель
      name       TEXT,                      -- как его зовут в Telegram
      username   TEXT,
      order_id   INTEGER,                   -- если вопрос по заказу
      direction  TEXT    NOT NULL,          -- 'in' — от покупателя, 'out' — от флориста
      text       TEXT,
      photo      TEXT,                      -- file_id фото в Telegram, если прислали фото
      is_read    INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS messages_user ON messages(user_id, id);
  `);
  db.pragma('user_version = 4');
}

if (db.pragma('user_version', { simple: true }) < 5) {
  // v5: остатки, допы к заказу, размеры букетов
  db.exec(`
    ALTER TABLE products ADD COLUMN stock INTEGER;                     -- NULL = без учёта остатка
    ALTER TABLE products ADD COLUMN addon INTEGER NOT NULL DEFAULT 0;  -- 1 = «добавить к заказу» (ваза, шары…)
    ALTER TABLE products ADD COLUMN emoji TEXT;                        -- картинка-эмодзи, если нет фото
    ALTER TABLE products ADD COLUMN sizes TEXT;                        -- JSON: [{"name":"S","price":2490,"note":"11 цветов"}, …]
  `);
  const addAddon = db.prepare(`INSERT INTO products (category, name, description, price, bg, emoji, addon, sort)
                               VALUES ('Дополнения', ?, ?, ?, ?, ?, 1, ?)`);
  [
    ['Стеклянная ваза',          'Чтобы букет сразу встал в воду',       690,  '#e3eef3', '🏺'],
    ['Большая авторская открытка','Крафт, ручная каллиграфия',            250,  '#f3e6dc', '💌'],
    ['Шоколад ручной работы',     'Бельгийский, 100 г, в подарочной коробке', 450, '#efe3dc', '🍫'],
    ['Воздушные шары, 5 шт',      'Пастельные, с гелием, держатся 2–3 дня', 990, '#e9e0f3', '🎈'],
    ['Мишка Тедди',               'Плюшевый, 25 см',                      1290, '#f5f0d8', '🧸'],
  ].forEach((a, i) => addAddon.run(...a, 200 + i));
  // Размеры для нескольких букетов (если они ещё есть в каталоге)
  const setSizes = db.prepare('UPDATE products SET sizes = ?, price = ? WHERE name = ?');
  const sz = (rows) => JSON.stringify(rows.map(([name, price, note]) => ({ name, price, note })));
  setSizes.run(sz([['S', 2490, 'компактный, ~25 см'], ['M', 3490, 'классический, ~35 см'], ['L', 4990, 'пышный, ~45 см']]), 2490, 'Утро в Провансе');
  setSizes.run(sz([['S', 1890, '15 тюльпанов'], ['M', 2890, '25 тюльпанов'], ['L', 4990, '51 тюльпан']]), 1890, 'Весенний микс');
  setSizes.run(sz([['S', 1490, 'маленький'], ['M', 2190, 'средний'], ['L', 3290, 'большой']]), 1490, 'Полевой');
  db.pragma('user_version = 5');
  console.log('🎁 База обновлена: остатки, допы к заказу и размеры букетов');
}

if (db.pragma('user_version', { simple: true }) < 6) {
  // v6: id последнего сообщения о статусе — старое удаляем, чтобы не засорять чат покупателя
  db.exec(`ALTER TABLE orders ADD COLUMN status_msg_id INTEGER;`);
  db.pragma('user_version = 6');
}

if (db.pragma('user_version', { simple: true }) < 7) {
  // v7: фото готового букета на согласование с покупателем
  db.exec(`
    ALTER TABLE orders ADD COLUMN bouquet_photo TEXT;   -- file_id фото в Telegram
    ALTER TABLE orders ADD COLUMN photo_status  TEXT;   -- 'pending' ждём ответа · 'approved' одобрен · 'changes' просят изменить
  `);
  db.pragma('user_version = 7');
}

if (db.pragma('user_version', { simple: true }) < 8) {
  // v8: когда отправили фото на согласование и напоминали ли покупателю
  db.exec(`
    ALTER TABLE orders ADD COLUMN photo_sent_at  TEXT;
    ALTER TABLE orders ADD COLUMN photo_reminded INTEGER NOT NULL DEFAULT 0;
  `);
  db.pragma('user_version = 8');
}

if (db.pragma('user_version', { simple: true }) < 9) {
  // v9: онлайн-оплата ЮKassa
  db.exec(`
    ALTER TABLE orders ADD COLUMN payment_id     TEXT;
    ALTER TABLE orders ADD COLUMN payment_status TEXT;   -- NULL без онлайн-оплаты · 'pending' ждёт · 'paid' оплачен · 'canceled' не оплачен
    ALTER TABLE orders ADD COLUMN paid_at        TEXT;
  `);
  db.pragma('user_version = 9');
}

if (db.pragma('user_version', { simple: true }) < 10) {
  // v10: ссылка на оплату — чтобы покупатель мог вернуться к оплате из «Мои заказы»
  db.exec(`ALTER TABLE orders ADD COLUMN pay_url TEXT;`);
  db.pragma('user_version = 10');
}

const parseProduct = (p) => p && { ...p, sizes: p.sizes ? JSON.parse(p.sizes) : null };
const parseOrder = (o) => o && { ...o, items: JSON.parse(o.items) };

module.exports = {
  STATUSES,

  // ── Товары ──
  // Для витрины — только те, что в наличии
  getProducts: () => db.prepare('SELECT * FROM products WHERE in_stock = 1 AND (stock IS NULL OR stock > 0) ORDER BY sort, id').all().map(parseProduct),
  // Для админки — все, включая скрытые
  getAllProducts: () => db.prepare('SELECT * FROM products ORDER BY addon, sort, id').all().map(parseProduct),
  getProduct: (id) => parseProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(id)),

  addProduct: (p) => {
    const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM products').get().s;
    const r = db.prepare(`INSERT INTO products (category, name, description, price, photo_url, badge, bg, in_stock, unit, min_qty,
                                                stock, addon, emoji, sizes, sort)
                          VALUES (@category, @name, @description, @price, @photo_url, @badge, @bg, @in_stock, @unit, @min_qty,
                                  @stock, @addon, @emoji, @sizes, ${sort})`).run(p);
    return r.lastInsertRowid;
  },
  updateProduct: (id, p) =>
    db.prepare(`UPDATE products SET category=@category, name=@name, description=@description, price=@price,
                photo_url=@photo_url, badge=@badge, bg=@bg, in_stock=@in_stock,
                unit=@unit, min_qty=@min_qty, stock=@stock, addon=@addon, emoji=@emoji, sizes=@sizes WHERE id=@id`).run({ ...p, id }),
  deleteProduct: (id) => db.prepare('DELETE FROM products WHERE id = ?').run(id),

  // ── Заказы ──
  // Заказ + списание остатков — одной транзакцией: либо всё, либо ничего
  createOrder: db.transaction((o) => {
    const low = [];
    for (const it of o.items) {
      const p = db.prepare('SELECT name, stock FROM products WHERE id = ?').get(it.id);
      if (p && p.stock != null) {
        if (p.stock < it.qty) throw new Error(`«${p.name}»: осталось только ${p.stock} шт`);
        db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(it.qty, it.id);
        low.push({ id: it.id, name: p.name, left: p.stock - it.qty });
      }
    }
    const r = db.prepare(`INSERT INTO orders (user_id, username, customer_name, phone, address, delivery_date, delivery_time,
                                              recipient, card_text, comment, items, total, delivery_fee, delivery_km, delivery_zone)
                          VALUES (@user_id, @username, @customer_name, @phone, @address, @delivery_date, @delivery_time,
                                  @recipient, @card_text, @comment, @items, @total, @delivery_fee, @delivery_km, @delivery_zone)`)
      .run({ ...o, items: JSON.stringify(o.items) });
    return { id: r.lastInsertRowid, stockLeft: low };
  }),
  getOrder: (id) => parseOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(id)),
  getOrders: (limit = 50) => db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT ?').all(limit).map(parseOrder),
  getUserOrders: (userId) => db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 10').all(userId).map(parseOrder),
  getSetting,
  setSetting,
  // Заказы за последние N дней (по московскому времени) — для статистики
  getOrdersSince: (days) =>
    db.prepare(`SELECT *, date(created_at, '+3 hours') AS day FROM orders
                WHERE date(created_at, '+3 hours') > date('now', '+3 hours', ?) ORDER BY id`)
      .all(`-${days} days`).map(parseOrder),
  // Отмена возвращает цветы на склад, «отмена отмены» — снова списывает
  restock: (order, sign) => {
    for (const it of order.items) {
      db.prepare('UPDATE products SET stock = MAX(0, stock + ?) WHERE id = ? AND stock IS NOT NULL').run(sign * it.qty, it.id);
    }
  },
  setOrderStatus: (id, status) =>
    db.prepare(`UPDATE orders SET status = ?,
                done_at = CASE WHEN ? = 'done' THEN COALESCE(done_at, datetime('now')) ELSE done_at END
                WHERE id = ?`).run(status, status, id),

  // ── Календарь: сколько заказов уже на дату и интервал ──
  countSlot: (date, time) => db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE delivery_date = ? AND delivery_time = ?
                                         AND status != 'cancelled'`).get(date, time).n,
  getOrdersForDate: (date) => db.prepare(`SELECT * FROM orders WHERE delivery_date = ? AND status != 'cancelled'
                                          AND COALESCE(payment_status, '') != 'pending'
                                          ORDER BY delivery_time, id`).all(date).map(parseOrder),
  getLowStock: () => db.prepare(`SELECT name, stock, unit FROM products WHERE stock IS NOT NULL AND in_stock = 1
                                 AND stock <= CASE WHEN unit = 'шт' THEN 20 ELSE 2 END ORDER BY stock`).all(),

  // ── Переписка ──
  addMessage: (m) => db.prepare(`INSERT INTO messages (user_id, name, username, order_id, direction, text, photo, is_read)
                                 VALUES (@user_id, @name, @username, @order_id, @direction, @text, @photo, @is_read)`)
    .run({ name: null, username: null, order_id: null, text: null, photo: null, is_read: 0, ...m }).lastInsertRowid,
  // Список диалогов: последний месседж, имя, сколько непрочитанных
  getChats: () => db.prepare(`
    SELECT m.user_id, m.text, m.photo, m.direction, m.created_at,
           (SELECT name FROM messages WHERE user_id = m.user_id AND name IS NOT NULL ORDER BY id DESC LIMIT 1) AS name,
           (SELECT username FROM messages WHERE user_id = m.user_id AND username IS NOT NULL ORDER BY id DESC LIMIT 1) AS username,
           (SELECT COUNT(*) FROM messages WHERE user_id = m.user_id AND direction = 'in' AND is_read = 0) AS unread
    FROM messages m WHERE m.id IN (SELECT MAX(id) FROM messages GROUP BY user_id)
    ORDER BY m.id DESC LIMIT 100`).all(),
  getChat: (userId) => db.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT 200').all(userId).reverse(),
  markChatRead: (userId) => db.prepare(`UPDATE messages SET is_read = 1 WHERE user_id = ? AND direction = 'in'`).run(userId),
  unreadTotal: () => db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE direction = 'in' AND is_read = 0`).get().n,

  setStatusMsg: (id, msgId) => db.prepare('UPDATE orders SET status_msg_id = ? WHERE id = ?').run(msgId, id),

  setBouquetPhoto: (id, fileId) => db.prepare(`UPDATE orders SET bouquet_photo = ?, photo_status = 'pending',
                                                photo_sent_at = datetime('now'), photo_reminded = 0 WHERE id = ?`).run(fileId, id),
  // Фото ждут ответа: сколько минут прошло с отправки
  getPhotoPending: () => db.prepare(`SELECT *, (julianday('now') - julianday(photo_sent_at)) * 1440 AS waited_min
                                     FROM orders WHERE photo_status = 'pending' AND status NOT IN ('done', 'cancelled')`).all().map(parseOrder),
  markPhotoReminded: (id) => db.prepare('UPDATE orders SET photo_reminded = 1 WHERE id = ?').run(id),
  setPhotoStatus: (id, st) => db.prepare('UPDATE orders SET photo_status = ? WHERE id = ?').run(st, id),

  // ── Оплата ──
  setPayment: (id, paymentId, url) => db.prepare(`UPDATE orders SET payment_id = ?, payment_status = 'pending', pay_url = ? WHERE id = ?`).run(paymentId, url, id),
  getUserOrdersAll: (userId) => db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 30').all(userId).map(parseOrder),
  // true — если именно этот вызов отметил оплату (защита от двойных уведомлений)
  markPaid: (id) => db.prepare(`UPDATE orders SET payment_status = 'paid', paid_at = datetime('now')
                                WHERE id = ? AND payment_status = 'pending'`).run(id).changes === 1,
  markPaymentCanceled: (id) => db.prepare(`UPDATE orders SET payment_status = 'canceled'
                                           WHERE id = ? AND payment_status = 'pending'`).run(id).changes === 1,
  getUnpaidOlderThan: (min) => db.prepare(`SELECT * FROM orders WHERE payment_status = 'pending'
                                           AND created_at <= datetime('now', ?)`).all(`-${min} minutes`).map(parseOrder),

  // ── Отзывы ──
  // Доставленные заказы, где прошло delayMin минут и отзыв ещё не спрашивали
  getOrdersForReview: (delayMin) =>
    db.prepare(`SELECT * FROM orders WHERE status = 'done' AND review_asked = 0
                AND done_at <= datetime('now', ?)`).all(`-${delayMin} minutes`).map(parseOrder),
  markReviewAsked: (id) => db.prepare('UPDATE orders SET review_asked = 1 WHERE id = ?').run(id),
  setRating: (id, rating) => db.prepare('UPDATE orders SET rating = ? WHERE id = ?').run(rating, id),
  setReviewText: (id, text) => db.prepare('UPDATE orders SET review_text = ? WHERE id = ?').run(text, id),

  // ── Напоминания о поводах ──
  addReminder: (r) => db.prepare(`INSERT INTO reminders (user_id, order_id, occasion, event_date, remind_at)
                                  VALUES (@user_id, @order_id, @occasion, @event_date, @remind_at)`).run(r),
  getReminderByOrder: (orderId) => db.prepare('SELECT * FROM reminders WHERE order_id = ?').get(orderId),
  getUserReminders: (userId) => db.prepare('SELECT * FROM reminders WHERE user_id = ? ORDER BY event_date').all(userId),
  deleteReminder: (id, userId) => db.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?').run(id, userId),
  // Пора напомнить: дата наступила (по Москве)
  getDueReminders: () => db.prepare(`SELECT * FROM reminders WHERE remind_at <= date('now', '+3 hours')`).all(),
  // Повод ежегодный — после напоминания переносим на следующий год
  bumpReminder: (id) => db.prepare(`UPDATE reminders SET event_date = date(event_date, '+1 year'),
                                    remind_at = date(remind_at, '+1 year') WHERE id = ?`).run(id),
};
