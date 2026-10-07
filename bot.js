require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const db = require('./db');
const { requireTelegram, requireOwner } = require('./auth');
const delivery = require('./delivery');
const setupChat = require('./chat');
const payments = require('./payments');

const { BOT_TOKEN, WEBAPP_URL, OWNER_ID, PORT = 3000 } = process.env;
if (!BOT_TOKEN || !WEBAPP_URL) {
  console.error('❌ Заполни BOT_TOKEN и WEBAPP_URL в файле .env');
  process.exit(1);
}
if (!OWNER_ID) console.warn('⚠️  OWNER_ID не задан — админка и уведомления о заказах отключены. Узнай свой ID командой /myid');

// TELEGRAM_API_ROOT — посредник для Telegram (нужен, если сервер в России)
const bot = new Telegraf(BOT_TOKEN, process.env.TELEGRAM_API_ROOT ? { telegram: { apiRoot: process.env.TELEGRAM_API_ROOT.replace(/\/*$/, '/') } } : {});
let chat; // кнопки и диалоги в чате — подключаются ниже, после команд (см. chat.js)
const app = express();
// ngrok и Railway стоят «перед» сервером — берём настоящий IP посетителя из их заголовка
app.set('trust proxy', 1);
// Обычные запросы — до 100 КБ; загрузка фото из админки — до 8 МБ
const jsonSmall = express.json({ limit: '100kb' }), jsonBig = express.json({ limit: '8mb' });
app.use((req, res, next) => (req.path === '/api/admin/upload' || /^\/api\/admin\/orders\/\d+\/photo$/.test(req.path) ? jsonBig : jsonSmall)(req, res, next));

// Фото, загруженные из админки. На Railway папка должна лежать на диске /data (DATA_DIR=/data)
const UPLOAD_DIR = path.join(process.env.DATA_DIR || __dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d' }));
app.use(express.static(path.join(__dirname, 'public')));

// Фото букетов лежат в проекте: public/photos (видно в VS Code и на GitHub).
// Файл «<id товара>-название.jpg» один раз ставится товару; если потом заменить фото в админке — не перезапишется.
const PHOTOS_DIR = path.join(__dirname, 'public', 'photos');
if (fs.existsSync(PHOTOS_DIR)) {
  for (const file of fs.readdirSync(PHOTOS_DIR)) {
    const m = file.match(/^(\d+)-[\w.-]+\.(jpe?g|png|webp)$/i);
    if (!m || db.getSetting(`photo_applied:${file}`, null)) continue;
    if (db.setProductPhoto(Number(m[1]), `/photos/${file}`)) console.log(`📷 Фото из проекта: ${file}`);
    db.setSetting(`photo_applied:${file}`, new Date().toISOString());
  }
}

// Экранируем текст для сообщений Telegram в режиме HTML (чтобы «<» в открытке ничего не сломал)
const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rub = (n) => n.toLocaleString('ru-RU') + ' ₽';
// Сколько одинаковых букетов/допов можно в одном заказе (поштучные цветы — до 501).
// Больше — это уже оптовый заказ: пусть покупатель напишет флористу.
const MAX_PER_ITEM = 10;
const TIME_SLOTS = ['09:00–12:00', '12:00–15:00', '15:00–18:00', '18:00–21:00'];

// Календарь: выходные дни и лимит заказов на один интервал (0 = без лимита). Настраивается в админке.
const getCalendar = () => db.getSetting('calendar', { closed: [], slotLimit: 0 });
function slotsFor(date) {
  const cal = getCalendar();
  const closed = cal.closed.includes(date);
  return {
    closed,
    slots: TIME_SLOTS.map((time) => {
      const taken = cal.slotLimit ? db.countSlot(date, time) : 0;
      const left = cal.slotLimit ? Math.max(0, cal.slotLimit - taken) : null;
      return { time, available: !closed && (left === null || left > 0), left };
    }),
  };
}

// Красивый текст заказа — используется и для покупателя, и для владелицы
// «Сегодня, 18–21» вместо «01.10.2026, 18:00–21:00»
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const mskDay = (plus = 0) => new Date(Date.now() + 3 * 3600e3 + plus * 864e5).toISOString().slice(0, 10);
const niceDay = (d) => d === mskDay(0) ? 'Сегодня' : d === mskDay(1) ? 'Завтра' : `${+d.slice(8)} ${MONTHS[+d.slice(5, 7) - 1]}`;
// «18:00–21:00» → «с 18:00 до 21:00»
const slotText = (t) => { const [a, b] = String(t || '').split(/[–-]/); return b ? `с ${a.trim()} до ${b.trim()}` : String(t || ''); };
const niceWhen = (o) => `${niceDay(o.delivery_date)} ${slotText(o.delivery_time)}`;
const shortWhen = (o) => `${niceDay(o.delivery_date)}, ${o.delivery_time.replace(/:00/g, '')}`; // компактно — для витрины

// Текст заказа — спокойный, без лишних эмодзи: что, когда, куда, сколько
function orderText(o, forOwner = false, withHeader = true) {
  const lines = [];
  if (withHeader) lines.push(`<b>Заказ №${o.id}</b> · ${db.STATUSES[o.status].replace(/^\S+\s/, '')}`);
  lines.push(`🕒 ${niceWhen(o)}`, `📍 ${esc(o.address)}`, '');
  for (const i of o.items) lines.push(`${esc(i.name)}${i.qty > 1 || i.unit ? ` × ${i.qty}${i.unit ? ' шт' : ''}` : ''} — ${rub(i.price * i.qty)}`);
  lines.push(o.delivery_fee == null ? 'Доставка — уточним' : `Доставка — ${o.delivery_fee ? rub(o.delivery_fee) : 'бесплатно'}`);
  lines.push(`<b>Итого ${rub(o.total)}</b>`);
  const extra = [];
  if (o.recipient) extra.push(`🎁 ${esc(o.recipient)}`);
  if (o.card_text) extra.push(`💌 «${esc(o.card_text)}»`);
  if (o.comment) extra.push(`💬 ${esc(o.comment)}`);
  if (forOwner) extra.push(`👤 ${esc(o.customer_name)}${o.username ? ' @' + esc(o.username) : ''} · ${esc(o.phone)}`);
  if (extra.length) lines.push('', ...extra);
  return lines.join('\n');
}

// Короткие сообщения покупателю о смене статуса — без повтора всего чека
// Трекер этапов: ✔ пройдено, ▸ сейчас, ○ впереди
// [статус, как звучит сейчас, как звучит когда пройден]
const STEPS = [['new', 'Принят', 'Принят'], ['confirmed', 'Подтверждён', 'Подтверждён'], ['assembling', 'Собираем букет', 'Букет собран'],
               ['delivering', 'В пути', 'Доставка'], ['done', 'Доставлен', 'Доставлен']];
function tracker(status) {
  const cur = STEPS.findIndex(([k]) => k === status);
  return STEPS.map(([, now, past], i) => i < cur ? `✔︎  ${past}` : i === cur ? `▸  <b>${now}</b>` : `○  ${now}`).join('\n');
}

// Сообщение покупателю о смене статуса: заголовок, тёплая фраза, трекер, детали
function statusNote(o) {
  const when = niceWhen(o).replace(/^Сегодня|^Завтра/, (w) => w.toLowerCase());
  const head = {
    new:        ['🕊 Заказ снова в обработке', 'Скоро всё подтвердим'],
    confirmed:  ['✅ Заказ подтверждён!', `Ждите букет ${when} 🌷`],
    assembling: ['💐 Флорист собирает ваш букет', 'Подбираем самые свежие цветы — с любовью и вниманием к каждой веточке'],
    delivering: ['🚚 Курьер уже в пути!', 'Совсем скоро букет будет у вас. Держите телефон рядом 📱'],
    done:       ['🌷 Букет доставлен!', 'Надеемся, он подарил много радости. Спасибо, что выбрали «Флёр» ❤️'],
    cancelled:  ['Заказ отменён', 'Если это ошибка или хотите что-то изменить — просто напишите нам сюда'],
  }[o.status];
  const lines = [`<b>${head[0]}</b>`, head[1], ''];
  if (o.status !== 'cancelled') lines.push(tracker(o.status), '');
  lines.push(`📦 Заказ №${o.id}`, `🕒 ${niceWhen(o)}`);
  if (o.status === 'delivering') lines.push(`📍 ${esc(o.address)}`);
  return lines.join('\n');
}

// Фото букета из заказа (первый товар с фото, не доп) — для красивого статуса
function orderPhoto(o) {
  if (o.bouquet_photo) return o.bouquet_photo; // настоящее фото собранного букета — лучше всего
  for (const it of o.items) {
    const p = db.getProduct(it.id);
    if (!p || p.addon || !p.photo_url) continue;
    const full = p.photo_url.replace(/_min\.webp$/, '.png').replace(/_min\.jpg$/, '.jpg');
    return full.startsWith('/') ? new URL(full, WEBAPP_URL).toString() : full;
  }
  return null;
}

// Кнопки смены статуса под сообщением владелице
const statusButtons = (id) =>
  Markup.inlineKeyboard([
    [Markup.button.callback('✅ Подтвердить', `st:${id}:confirmed`), Markup.button.callback('💐 Собираем', `st:${id}:assembling`)],
    [Markup.button.callback('🚚 В пути', `st:${id}:delivering`), Markup.button.callback('🌷 Доставлен', `st:${id}:done`)],
    [Markup.button.callback('📸 Фото букета', `photo:${id}`), Markup.button.callback('❌ Отменить', `st:${id}:cancelled`)],
  ]);

// Смена статуса + уведомление покупателю. Общая для кнопок в чате и для админки.
async function changeStatus(id, status) {
  if (!db.STATUSES[status]) throw new Error('Неизвестный статус');
  const order = db.getOrder(id);
  if (!order) throw new Error('Заказ не найден');
  if (status === 'cancelled' && order.status !== 'cancelled') db.restock(order, +1); // вернули цветы на склад
  if (order.status === 'cancelled' && status !== 'cancelled') db.restock(order, -1);
  db.setOrderStatus(id, status);
  const updated = db.getOrder(id);
  // Прошлое сообщение о статусе убираем — в чате остаётся только актуальное
  if (order.status_msg_id) await bot.telegram.deleteMessage(order.user_id, order.status_msg_id).catch(() => {});
  const kb = status === 'done' ? Markup.inlineKeyboard([Markup.button.webApp('🔁 Повторить заказ', chat.shopUrl({ repeat: id }))])
    : status === 'cancelled' ? Markup.inlineKeyboard([Markup.button.callback('💬 Написать флористу', `ask:${id}`)])
    : {};
  // С фото букета — живее. Если Telegram не смог загрузить картинку, отправим просто текст
  const photo = status === 'cancelled' ? null : orderPhoto(updated);
  let msg = photo
    ? await bot.telegram.sendPhoto(order.user_id, photo, { caption: statusNote(updated), parse_mode: 'HTML', ...kb }).catch(() => null)
    : null;
  if (!msg) {
    msg = await bot.telegram.sendMessage(order.user_id, statusNote(updated), { parse_mode: 'HTML', ...kb })
      .catch((e) => console.error('Не смогла написать покупателю:', e.message));
  }
  if (msg?.message_id) db.setStatusMsg(id, msg.message_id);
  return updated;
}

// ─── Защита от спама: ограничение частоты запросов ───────
// Простой счётчик в памяти: ключ → список времени последних запросов
function rateLimit({ max, windowMs, key, message }) {
  const hits = new Map();
  setInterval(() => { // раз в минуту убираем старые записи, чтобы память не росла
    const now = Date.now();
    for (const [k, list] of hits) {
      const fresh = list.filter((t) => now - t < windowMs);
      fresh.length ? hits.set(k, fresh) : hits.delete(k);
    }
  }, 60_000).unref();
  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    const list = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) return res.status(429).json({ error: message });
    list.push(now);
    hits.set(k, list);
    next();
  };
}
// Не больше 120 запросов к API в минуту с одного адреса — от «долбёжки» сервера
app.use('/api', rateLimit({ max: 120, windowMs: 60_000, key: (req) => req.ip, message: 'Слишком много запросов, подождите минутку' }));
// Не больше 5 заказов за 10 минут с одного Telegram-аккаунта
const orderLimit = rateLimit({
  max: 5, windowMs: 10 * 60_000, key: (req) => req.tgUser.id,
  message: 'Слишком много заказов подряд 🌷 Попробуйте через 10 минут или напишите нам',
});

// ─── API для витрины ─────────────────────────────────────
app.get('/api/products', (req, res) => res.json(db.getProducts()));

// Цены берём ТОЛЬКО из базы — покупатель не может подменить их в браузере
function priceItems(raw) {
  const items = [];
  for (const it of Array.isArray(raw) ? raw : []) {
    const p = db.getProduct(Number(it.id));
    const qty = Math.floor(Number(it.qty));
    if (!p || !p.in_stock) throw new Error('Некоторых букетов уже нет в наличии, обновите витрину');
    // Поштучно — не меньше минимума (например, от 5 роз) и не больше 501; букеты — от 1 до 99
    const min = p.min_qty || 1, max = p.unit ? 501 : MAX_PER_ITEM;
    if (!(qty >= min && qty <= max)) throw new Error(`«${p.name}»: можно заказать от ${min} до ${max} шт`);
    // Размер S/M/L — своя цена
    let price = p.price, name = p.name, size = null;
    if (p.sizes?.length) {
      const s = p.sizes.find((x) => x.name === it.size) || p.sizes[0];
      price = s.price; size = s.name; name = `${p.name} (${s.name})`;
    }
    items.push({ id: p.id, name, price, qty, unit: p.unit || null, size });
  }
  // Хватает ли остатка (с учётом того, что один букет может быть в корзине в разных размерах)
  const need = {};
  for (const i of items) need[i.id] = (need[i.id] || 0) + i.qty;
  for (const [id, n] of Object.entries(need)) {
    const p = db.getProduct(Number(id));
    if (!p.unit && n > MAX_PER_ITEM) throw new Error(`«${p.name}»: в одном заказе до ${MAX_PER_ITEM} шт. Для большего заказа напишите флористу 💐`);
    if (p.stock != null && p.stock < n) throw new Error(`«${p.name}»: осталось только ${p.stock} шт`);
  }
  if (!items.length) throw new Error('Корзина пуста');
  return items;
}

// Расчёт доставки, пока покупатель вводит адрес
const quoteLimit = rateLimit({ max: 30, windowMs: 10 * 60_000, key: (req) => req.tgUser.id, message: 'Слишком много проверок адреса, подождите пару минут' });
app.post('/api/delivery-quote', requireTelegram(BOT_TOKEN), quoteLimit, async (req, res) => {
  const address = String(req.body?.address ?? '').trim().slice(0, 300);
  if (address.length < 5) return res.status(400).json({ error: 'Введите адрес' });
  let itemsTotal = 0;
  try { itemsTotal = priceItems(req.body.items).reduce((s, i) => s + i.price * i.qty, 0); } catch {}
  try {
    const q = await delivery.quote(address, req.body.zone === 'region' ? 'region' : 'city', itemsTotal);
    res.status(q.ok ? 200 : 400).json(q.ok ? q : { error: q.error });
  } catch (e) {
    console.error('Геокодер:', e.message);
    res.json({ ok: true, fee: null, error: 'Не получилось рассчитать доставку — уточним после заказа' });
  }
});
app.get('/api/delivery-info', (req, res) => {
  const t = delivery.getTariff();
  res.json({ shop: delivery.SHOP.name, city: t.city, region: t.region, freeFrom: t.freeFrom, payOnline: payments.enabled });
});

// Для кнопки «Повторить заказ»: отдаём покупателю ЕГО заказ, чтобы собрать корзину заново
// «Мои заказы» в витрине: все заказы покупателя (только его собственные)
app.get('/api/my-orders', requireTelegram(BOT_TOKEN), (req, res) => {
  res.json(db.getUserOrdersAll(req.tgUser.id).map((o) => ({
    id: o.id, status: o.status, status_label: db.STATUSES[o.status].replace(/^\S+\s/, ''),
    items: o.items.map(({ id, name, qty, unit, price }) => ({ id, name, qty, unit, price })),
    total: o.total, delivery_fee: o.delivery_fee, when: shortWhen(o), address: o.address,
    card_text: o.card_text, recipient: o.recipient, rating: o.rating,
    payment_status: o.payment_status, pay_url: o.payment_status === 'pending' ? o.pay_url : null,
    photo_status: o.photo_status,
  })));
});

app.get('/api/my-orders/:id', requireTelegram(BOT_TOKEN), (req, res) => {
  const o = db.getOrder(Number(req.params.id));
  if (!o || String(o.user_id) !== String(req.tgUser.id)) return res.status(404).json({ error: 'Заказ не найден' });
  res.json({ id: o.id, items: o.items.map(({ id, qty, size }) => ({ id, qty, size })), address: o.address,
             zone: o.delivery_zone === 'Ленобласть' ? 'region' : 'city', recipient: o.recipient });
});

// Свободные интервалы на дату (витрина показывает занятые серым)
app.get('/api/slots', (req, res) => {
  const date = String(req.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Неверная дата' });
  res.json(slotsFor(date));
});

app.post('/api/orders', requireTelegram(BOT_TOKEN), orderLimit, async (req, res) => {
  const b = req.body || {};
  const str = (v, max) => String(v ?? '').trim().slice(0, max);

  let items;
  try { items = priceItems(b.items); } catch (e) { return res.status(400).json({ error: e.message }); }
  const itemsTotal = items.reduce((s, i) => s + i.price * i.qty, 0);

  const order = {
    user_id: req.tgUser.id,
    username: req.tgUser.username || null,
    customer_name: str(b.customer_name, 100),
    phone: str(b.phone, 30),
    address: str(b.address, 300),
    delivery_date: str(b.delivery_date, 10),
    delivery_time: str(b.delivery_time, 20),
    recipient: str(b.recipient, 100) || null,
    card_text: str(b.card_text, 300) || null,
    comment: str(b.comment, 300) || null,
    items,
    total: itemsTotal,
    delivery_fee: null,
    delivery_km: null,
    delivery_zone: null,
  };

  if (!order.customer_name) return res.status(400).json({ error: 'Укажите имя' });
  if (order.phone.replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Проверьте номер телефона' });
  if (order.address.length < 5) return res.status(400).json({ error: 'Укажите адрес доставки' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(order.delivery_date)) return res.status(400).json({ error: 'Выберите дату доставки' });
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  if (order.delivery_date < yesterday) return res.status(400).json({ error: 'Дата доставки уже прошла' });
  if (!TIME_SLOTS.includes(order.delivery_time)) return res.status(400).json({ error: 'Выберите время доставки' });
  const day = slotsFor(order.delivery_date);
  if (day.closed) return res.status(400).json({ error: 'В этот день мы не работаем 🌿 Выберите другую дату' });
  if (!day.slots.find((x) => x.time === order.delivery_time).available) {
    return res.status(400).json({ error: 'На это время заказов уже много 🙈 Выберите другой интервал' });
  }

  // Доставку пересчитываем на сервере — сумме из браузера не доверяем.
  // Если геокодер временно не отвечает, заказ всё равно примем, а стоимость доставки уточним вручную.
  try {
    const q = await delivery.quote(order.address, b.delivery_zone === 'region' ? 'region' : 'city', itemsTotal);
    if (!q.ok) return res.status(400).json({ error: q.error });
    Object.assign(order, { delivery_fee: q.fee, delivery_km: q.km, delivery_zone: q.zone, total: itemsTotal + q.fee });
  } catch (e) {
    console.error('Геокодер недоступен, доставку уточним вручную:', e.message);
  }

  let created;
  try { created = db.createOrder(order); } catch (e) { return res.status(400).json({ error: e.message }); }
  const id = created.id;
  const saved = db.getOrder(id);
  // Остаток подходит к концу — предупреждаем владелицу
  if (OWNER_ID) {
    for (const s of created.stockLeft) {
      const p = db.getProduct(s.id);
      const limit = p.unit ? 20 : 2;
      if (s.left <= limit) {
        bot.telegram.sendMessage(OWNER_ID, s.left === 0
          ? `⛔️ «${esc(s.name)}» закончился — скрыт из витрины. Пополнить можно в /admin → Букеты`
          : `⚠️ «${esc(s.name)}»: осталось ${s.left} шт`, { parse_mode: 'HTML' }).catch(() => {});
      }
    }
  }

  // Онлайн-оплата включена — сначала оплата, а флористу сообщим, когда деньги придут
  if (payments.enabled && saved.delivery_fee != null) {
    try {
      const pay = await payments.createPayment({
        orderId: id, amount: saved.total,
        description: `Заказ №${id} в цветочной лавке «Флёр»`,
        returnUrl: `https://t.me/${bot.botInfo?.username || ''}`,
      });
      const url = pay.confirmation.confirmation_url;
      db.setPayment(id, pay.id, url);
      const msg = await bot.telegram.sendMessage(order.user_id,
        `🌷 <b>Заказ №${id} оформлен!</b>\nОсталось оплатить — после оплаты флорист сразу возьмётся за букет.\n\n${orderText(saved, false, false)}`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([Markup.button.url(`💳 Оплатить ${rub(saved.total)}`, url)]) }).catch(() => null);
      if (msg?.message_id) db.setStatusMsg(id, msg.message_id);
      return res.json({ ok: true, id, pay_url: url, total: saved.total });
    } catch (e) {
      console.error('Не удалось создать платёж:', e.message); // заказ не теряем — флорист договорится об оплате сам
    }
  }
  await notifyNewOrder(saved);
  res.json({ ok: true, id });
});

// Сообщения «заказ принят» покупателю и «новый заказ» владелице
async function notifyNewOrder(o, paid = false) {
  await bot.telegram
    .sendMessage(o.user_id, `🌷 <b>Заказ №${o.id} ${paid ? 'оплачен и принят' : 'принят'}!</b>\nФлорист подтвердит его в ближайшее время.\n\n${orderText(o, false, false)}`,
      { parse_mode: 'HTML', ...chat.orderKeyboard(o) })
    .catch((e) => console.error('Не смогла написать покупателю:', e.message));
  if (OWNER_ID) {
    const payNote = paid ? '💳 Оплачен онлайн' : payments.enabled ? '⚠️ Онлайн-оплата не создалась — договоритесь об оплате' : '';
    await bot.telegram
      .sendMessage(OWNER_ID, `🔔 Новый заказ!${payNote ? '\n' + payNote : ''}\n\n${orderText(o, true)}`, { parse_mode: 'HTML', ...statusButtons(o.id) })
      .catch((e) => console.error('Не смогла написать владелице:', e.message));
  }
}

// ─── Оплата: уведомления ЮKassa и проверка неоплаченных ──
async function onPaid(orderId) {
  if (!db.markPaid(orderId)) return;                 // уже отмечен — повторное уведомление игнорируем
  let o = db.getOrder(orderId);
  if (o.status === 'cancelled') {                    // заказ отменили, а покупатель всё-таки оплатил — не теряем деньги
    db.restock(o, -1); db.setOrderStatus(orderId, 'new'); o = db.getOrder(orderId);
    if (OWNER_ID) bot.telegram.sendMessage(OWNER_ID, `⚠️ Заказ №${o.id} был отменён, но покупатель его оплатил — вернула заказ в работу. Проверьте, есть ли цветы, или оформите возврат в ЮKassa.`).catch(() => {});
  }
  if (o.status_msg_id) await bot.telegram.deleteMessage(o.user_id, o.status_msg_id).catch(() => {}); // убираем «Оплатить»
  db.setStatusMsg(orderId, null);
  await notifyNewOrder(o, true);
}
async function onLatePaid(orderId) {
  if (!db.revivePaid(orderId)) return;
  const o0 = db.getOrder(orderId);
  db.restock(o0, -1); db.setOrderStatus(orderId, 'new');
  const o = db.getOrder(orderId);
  await notifyNewOrder(o, true);
  if (OWNER_ID) bot.telegram.sendMessage(OWNER_ID, `⚠️ Оплата по заказу №${o.id} пришла уже после автоотмены — заказ снова в работе. Проверьте наличие цветов.`).catch(() => {});
}
async function onUnpaid(orderId, reason, expired = false) {
  if (!(expired ? db.markPaymentExpired(orderId) : db.markPaymentCanceled(orderId))) return;
  const o = db.getOrder(orderId);
  if (o.status !== 'cancelled') { db.restock(o, +1); db.setOrderStatus(orderId, 'cancelled'); }
  if (o.status_msg_id) await bot.telegram.deleteMessage(o.user_id, o.status_msg_id).catch(() => {});
  await bot.telegram.sendMessage(o.user_id, `Заказ №${o.id} отменён: ${reason}.\nЕсли хотите — оформите заново, корзину можно повторить 🌷`,
    Markup.inlineKeyboard([Markup.button.webApp('🔁 Оформить заново', chat.shopUrl({ repeat: o.id }))])).catch(() => {});
}
// Проверяем платёж у самой ЮKassa: уведомление может подделать кто угодно, а API — нет
async function syncPayment(paymentId) {
  const p = await payments.getPayment(paymentId);
  const orderId = Number(p.metadata?.order_id);
  const o = orderId && db.getOrder(orderId);
  if (!o || o.payment_id !== p.id) return;
  if (p.status === 'succeeded' && Math.round(Number(p.amount.value)) === o.total) {
    if (o.payment_status === 'expired' || o.payment_status === 'canceled') await onLatePaid(orderId); else await onPaid(orderId);
  }
  if (p.status === 'canceled') await onUnpaid(orderId, 'оплата не прошла');
}
app.post('/yookassa-webhook', async (req, res) => {
  res.sendStatus(200); // ЮKassa ждёт быстрый ответ
  const id = req.body?.object?.id;
  if (payments.enabled && id) syncPayment(id).catch((e) => console.error('ЮKassa webhook:', e.message));
});
// Раз в минуту сами спрашиваем ЮKassa о неоплаченных заказах.
// Так оплата подтверждается за минуту даже без уведомлений (например, пока бот на ноутбуке),
// а заказы без оплаты дольше 30 минут отменяются, цветы возвращаются на склад.
const PAY_TIMEOUT_MIN = 30;
setInterval(async () => {
  if (!payments.enabled) return;
  for (const o of db.getUnpaid()) {
    try {
      const p = await payments.getPayment(o.payment_id);
      if (p.status === 'succeeded' && Math.round(Number(p.amount.value)) === o.total) await onPaid(o.id);
      else if (p.status === 'canceled') await onUnpaid(o.id, 'оплата не прошла');
      else if (o.age_min >= PAY_TIMEOUT_MIN) await onUnpaid(o.id, `оплата не поступила за ${PAY_TIMEOUT_MIN} минут`, true);
    } catch (e) { console.error('Проверка оплаты:', e.message); }
  }
  // Автоотменённые за последние сутки: вдруг оплата всё же прошла
  for (const o of db.getExpired()) {
    try {
      const p = await payments.getPayment(o.payment_id);
      if (p.status === 'succeeded' && Math.round(Number(p.amount.value)) === o.total) await onLatePaid(o.id);
      else if (p.status === 'canceled') db.setPaymentStatus(o.id, 'canceled');
    } catch (e) { console.error('Проверка поздней оплаты:', e.message); }
  }
}, 60_000).unref();

// ─── API для админки (только владелица) ──────────────────
const owner = requireOwner(BOT_TOKEN, OWNER_ID);

// Приводим данные товара из формы к правильному виду
function cleanProduct(b = {}) {
  const p = {
    category: String(b.category ?? '').trim().slice(0, 40),
    name: String(b.name ?? '').trim().slice(0, 80),
    description: String(b.description ?? '').trim().slice(0, 200),
    price: Math.round(Number(b.price)),
    photo_url: String(b.photo_url ?? '').trim().slice(0, 500) || null,
    badge: String(b.badge ?? '').trim().slice(0, 20) || null,
    bg: /^#[0-9a-f]{6}$/i.test(b.bg) ? b.bg : '#f6e3ea',
    in_stock: b.in_stock === false || b.in_stock === 0 ? 0 : 1,
    unit: b.unit ? 'шт' : null,                                  // галочка «продаётся поштучно»
    min_qty: Math.min(101, Math.max(1, Math.floor(Number(b.min_qty)) || 1)),
    // Остаток: пусто — не считаем; число — списывается с каждым заказом
    stock: b.stock === '' || b.stock == null ? null : Math.max(0, Math.floor(Number(b.stock)) || 0),
    addon: b.addon ? 1 : 0,                                      // показывать в корзине «Добавить к заказу»
    emoji: String(b.emoji ?? '').trim().slice(0, 8) || null,
    sizes: null,
  };
  // Размеры S/M/L: [{name, price, note}]
  const sizes = (Array.isArray(b.sizes) ? b.sizes : [])
    .map((x) => ({ name: String(x.name ?? '').trim().slice(0, 12), price: Math.round(Number(x.price)), note: String(x.note ?? '').trim().slice(0, 40) }))
    .filter((x) => x.name && x.price > 0)
    .slice(0, 5);
  if (sizes.length) {
    p.sizes = JSON.stringify(sizes);
    p.price = Math.min(...sizes.map((x) => x.price)); // в каталоге — «от N ₽»
  }
  if (!p.category || !p.name) throw new Error('Заполните название и категорию');
  if (!(p.price > 0)) throw new Error('Цена должна быть больше нуля');
  if (p.photo_url && !/^(https:\/\/|\/uploads\/|\/photos\/)/.test(p.photo_url)) throw new Error('Ссылка на фото должна начинаться с https://');
  return p;
}
const handle = (fn) => async (req, res) => {
  try { res.json(await fn(req)); } catch (e) { res.status(400).json({ error: e.message }); }
};

app.get('/api/admin/products', owner, handle(() => db.getAllProducts()));
app.post('/api/admin/products', owner, handle((req) => ({ id: db.addProduct(cleanProduct(req.body)) })));
app.put('/api/admin/products/:id', owner, handle((req) => {
  if (!db.getProduct(Number(req.params.id))) throw new Error('Букет не найден');
  db.updateProduct(Number(req.params.id), cleanProduct(req.body));
  return { ok: true };
}));
app.delete('/api/admin/products/:id', owner, handle((req) => { db.deleteProduct(Number(req.params.id)); return { ok: true }; }));
app.get('/api/admin/orders', owner, handle(() => ({ orders: db.getOrders(100), statuses: db.STATUSES })));
app.post('/api/admin/orders/:id/status', owner, handle((req) => changeStatus(Number(req.params.id), req.body.status)));

// ─── Статистика ──────────────────────────────────────────
app.get('/api/admin/stats', owner, handle((req) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const all = db.getOrdersSince(days);
  // Отменённые и ещё не оплаченные в выручку не считаем
  const paid = all.filter((o) => o.status !== 'cancelled' && o.payment_status !== 'pending' && o.payment_status !== 'canceled');
  const itemsSum = (o) => o.items.reduce((s, i) => s + i.price * i.qty, 0);

  // По дням: заполняем все дни периода, даже пустые — чтобы график был честным
  const byDay = [];
  const today = new Date(Date.now() + 3 * 3600e3); // Москва
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today - i * 864e5).toISOString().slice(0, 10);
    const list = paid.filter((o) => o.day === d);
    byDay.push({ date: d, revenue: list.reduce((s, o) => s + o.total, 0), orders: list.length });
  }

  // Топ товаров по выручке
  const top = new Map();
  for (const o of paid) for (const i of o.items) {
    const t = top.get(i.id) || { name: i.name, qty: 0, revenue: 0, unit: i.unit };
    t.qty += i.qty; t.revenue += i.price * i.qty; top.set(i.id, t);
  }

  // Покупатели: сколько вернулись повторно
  const perUser = new Map();
  for (const o of paid) perUser.set(o.user_id, (perUser.get(o.user_id) || 0) + 1);

  const revenue = paid.reduce((s, o) => s + o.total, 0);
  const byStatus = {};
  for (const o of all) byStatus[o.status] = (byStatus[o.status] || 0) + 1;

  return {
    days,
    revenue,
    goods: paid.reduce((s, o) => s + itemsSum(o), 0),
    delivery: paid.reduce((s, o) => s + (o.delivery_fee || 0), 0),
    orders: paid.length,
    cancelled: byStatus.cancelled || 0,
    avg: paid.length ? Math.round(revenue / paid.length) : 0,
    customers: perUser.size,
    repeat: [...perUser.values()].filter((n) => n > 1).length,
    cards: paid.filter((o) => o.card_text).length,
    rated: paid.filter((o) => o.rating).length,
    rating: (() => { const r = paid.filter((o) => o.rating); return r.length ? Math.round(r.reduce((s, o) => s + o.rating, 0) / r.length * 10) / 10 : null; })(),
    byDay,
    top: [...top.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 7),
    byStatus,
    statuses: db.STATUSES,
  };
}));

// ─── Чаты с покупателями ─────────────────────────────────
app.get('/api/admin/chats', owner, handle(() => ({ chats: db.getChats(), unread: db.unreadTotal() })));
app.get('/api/admin/chats/:userId', owner, handle((req) => {
  const userId = Number(req.params.userId);
  db.markChatRead(userId);
  const orders = db.getUserOrders(userId).map((o) => ({ id: o.id, status: db.STATUSES[o.status], total: o.total, date: o.delivery_date }));
  return { messages: db.getChat(userId), orders };
}));
app.post('/api/admin/chats/:userId', owner, handle(async (req) => {
  const text = String(req.body?.text ?? '').trim();
  if (!text) throw new Error('Пустое сообщение');
  const orderId = Number(req.body.orderId) || null;
  try { await chat.toBuyer(Number(req.params.userId), text, orderId); }
  catch (e) { throw new Error('Telegram не доставил сообщение: ' + e.message); }
  return { messages: db.getChat(Number(req.params.userId)) };
}));
// Фото из переписки: Telegram хранит его у себя, отдаём через наш сервер (только владелице)
app.get('/api/admin/photo/:fileId', owner, async (req, res) => {
  try {
    const link = await bot.telegram.getFileLink(req.params.fileId);
    const r = await fetch(link);
    res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch { res.status(404).end(); }
});

// Загрузка фото с телефона: админка сама сжимает картинку и присылает два JPEG — большой и маленький
app.post('/api/admin/upload', owner, handle((req) => {
  const save = (b64, suffix) => {
    const buf = Buffer.from(String(b64 || '').replace(/^data:image\/jpeg;base64,/, ''), 'base64');
    if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('Это не похоже на фото (нужен JPEG)');
    if (buf.length > 5 * 1024 * 1024) throw new Error('Фото слишком большое');
    fs.writeFileSync(path.join(UPLOAD_DIR, name + suffix), buf);
  };
  const name = crypto.randomUUID();
  save(req.body.full, '.jpg');
  save(req.body.thumb, '_min.jpg');
  return { url: `/uploads/${name}_min.jpg` };
}));

// Фото готового букета из админки → покупателю на согласование
app.post('/api/admin/orders/:id/photo', owner, handle(async (req) => {
  const buf = Buffer.from(String(req.body.full || '').replace(/^data:image\/jpeg;base64,/, ''), 'base64');
  if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('Это не похоже на фото (нужен JPEG)');
  if (buf.length > 5 * 1024 * 1024) throw new Error('Фото слишком большое');
  return chat.sendBouquetPhoto(Number(req.params.id), { source: buf, filename: 'bouquet.jpg' });
}));

// Календарь: выходные и лимит заказов на интервал
// Резервная копия: бот присылает владелице ZIP в чат — каталог, заказы, отзывы, переписка, настройки, фото
app.post('/api/admin/backup', owner, handle(async () => {
  const { makeBackup } = require('./backup');
  const b = makeBackup({ uploadsDir: UPLOAD_DIR, photosDir: PHOTOS_DIR });
  await bot.telegram.sendDocument(OWNER_ID, { source: b.buffer, filename: b.filename },
    { caption: `📦 Резервная копия «Флёра»\nФото: ${b.photos} · заказы и каталог — в Excel-файлах внутри.\nХраните у себя: там телефоны и адреса покупателей.` });
  return { ok: true, size: b.buffer.length };
}));
app.get('/api/admin/calendar', owner, handle(() => getCalendar()));
// Сколько ждать ответа по фото букета (минут; 0 — не подтверждать автоматически)
app.get('/api/admin/photo-timeout', owner, handle(() => ({ minutes: db.getSetting('photo_timeout', 30) })));
app.put('/api/admin/photo-timeout', owner, handle((req) => {
  const minutes = Math.max(0, Math.min(240, Math.floor(Number(req.body.minutes)) || 0));
  db.setSetting('photo_timeout', minutes);
  return { minutes };
}));
app.put('/api/admin/calendar', owner, handle((req) => {
  const closed = [...new Set((Array.isArray(req.body.closed) ? req.body.closed : []).map(String)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort().slice(0, 100);
  const cal = { closed, slotLimit: Math.max(0, Math.min(99, Math.floor(Number(req.body.slotLimit)) || 0)) };
  db.setSetting('calendar', cal);
  return cal;
}));

app.get('/api/admin/delivery', owner, handle(() => delivery.getTariff()));
app.put('/api/admin/delivery', owner, handle((req) => {
  const t = delivery.cleanTariff(req.body);
  db.setSetting('delivery_tariff', t);
  return t;
}));

app.listen(PORT, () => console.log(`🌐 Витрина: http://localhost:${PORT}`));

// ─── Бот ─────────────────────────────────────────────────
const isOwner = (ctx) => OWNER_ID && String(ctx.from.id) === String(OWNER_ID);

bot.start((ctx) =>
  ctx.reply(
    `Привет, ${ctx.from.first_name}! 🌷\nЭто «Флёр» — свежие цветы с доставкой за 2 часа.\n\nЖми кнопку, чтобы открыть каталог. А если есть вопрос — просто напиши его сюда, флорист ответит 💬`,
    Markup.inlineKeyboard([
      [Markup.button.webApp('💐 Открыть магазин', WEBAPP_URL)],
      [Markup.button.callback('📦 Мои заказы', 'my_orders'), Markup.button.callback('💬 Написать флористу', 'ask:0')],
    ])
  )
);

bot.command('myid', (ctx) => ctx.reply(`Твой Telegram ID: ${ctx.from.id}\nВпиши его в .env как OWNER_ID=${ctx.from.id}`));

bot.command('admin', (ctx) => {
  if (!isOwner(ctx)) return ctx.reply('Эта команда только для владелицы магазина 🌷');
  return ctx.reply(
    'Панель управления «Флёр» 🛠',
    Markup.inlineKeyboard([Markup.button.webApp('⚙️ Открыть админку', WEBAPP_URL.replace(/\/$/, '') + '/admin.html')])
  );
});

// Кнопки статусов под уведомлением о заказе
bot.action(/^st:(\d+):(\w+)$/, async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery('Только для владелицы');
  try {
    const o = await changeStatus(Number(ctx.match[1]), ctx.match[2]);
    await ctx.editMessageText(orderText(o, true), { parse_mode: 'HTML', ...statusButtons(o.id) });
    await ctx.answerCbQuery(db.STATUSES[o.status]);
  } catch (e) {
    await ctx.answerCbQuery(e.message.slice(0, 190));
  }
});

// Диалоги в чате (мои заказы, связь с флористом, фото, отзывы, напоминания).
// Подключаем ПОСЛЕ команд: там есть обработчик любого текста, он не должен перехватывать /start и т.п.
chat = setupChat(bot, { OWNER_ID, WEBAPP_URL, orderText, esc });

// В Telegraf 4.16 код «после запуска» передаётся колбэком (promise launch() завершается только при остановке бота)
// Ошибка в одном обработчике не должна ронять бота целиком
bot.catch((err, ctx) => console.error('Ошибка бота:', ctx?.updateType, err?.message || err));
process.on('unhandledRejection', (e) => console.error('Необработанная ошибка:', e?.message || e));

bot.launch(async () => {
  console.log('🤖 Бот запущен');
  try {
    await bot.telegram.setChatMenuButton({
      menuButton: { type: 'web_app', text: 'Магазин', web_app: { url: WEBAPP_URL } },
    });
    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Открыть магазин' },
      { command: 'orders', description: 'Мои заказы' },
      { command: 'reminders', description: 'Мои напоминания о датах' },
    ]);
    if (OWNER_ID) { // у владелицы в меню ещё и служебные команды
      await bot.telegram.setMyCommands([
        { command: 'admin', description: 'Админка' },
        { command: 'today', description: 'Доставки на сегодня' },
        { command: 'tomorrow', description: 'Доставки на завтра' },
        { command: 'start', description: 'Открыть магазин' },
      ], { scope: { type: 'chat', chat_id: Number(OWNER_ID) } });
    }
  } catch (e) {
    console.error('Не удалось настроить меню бота:', e.message);
  }
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
