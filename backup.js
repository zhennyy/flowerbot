// backup.js — резервная копия «Флёра» одним ZIP-архивом (без сторонних библиотек).
// Внутри: букеты, заказы, отзывы, переписка, напоминания, настройки (JSON и CSV для Excel) и фото.
const fs = require('fs');
const path = require('path');
const db = require('./db');

// ---- минимальный ZIP (метод «хранение»: фото и так сжаты) ----
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); // utf-8 имена
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += local.length + name.length + data.length;
  }
  const cenBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cenBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cenBuf, end]);
}

const csv = (rows) => {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // «;» и BOM — чтобы Excel на Mac/Windows сразу открыл кириллицу по столбцам
  return '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => cell(r[c])).join(';'))].join('\n');
};

function photoFile(url, dirs) {
  const m = String(url || '').match(/\/(uploads|photos)\/([^/?#]+)$/);
  if (!m || !/^\/(uploads|photos)\//.test(String(url))) return null;
  const p = path.join(dirs[m[1]], m[2]);
  return fs.existsSync(p) ? { file: m[2], path: p } : null;
}

function makeBackup({ uploadsDir, photosDir }) {
  const q = (sql) => db.raw.prepare(sql).all();
  const products = q('SELECT * FROM products ORDER BY id');
  const orders = q('SELECT * FROM orders ORDER BY id');
  const messages = q('SELECT * FROM messages ORDER BY id');
  const reminders = q('SELECT * FROM reminders ORDER BY id');
  const settings = q('SELECT * FROM settings').filter((s) => !s.key.startsWith('photo_applied:'));
  const files = [];
  const dirs = { uploads: uploadsDir, photos: photosDir };
  for (const p of products) {
    const f = photoFile(p.photo_url, dirs);
    if (f) files.push({ name: `photos/${f.file.startsWith(p.id + '-') ? f.file : p.id + '-' + f.file}`, data: fs.readFileSync(f.path) });
  }
  const itemsText = (o) => { try { return JSON.parse(o.items).map((i) => `${i.name}${i.size ? ' (' + i.size + ')' : ''} × ${i.qty}`).join(', '); } catch { return ''; } };
  const stamp = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  files.push(
    { name: 'bouquets.json', data: JSON.stringify(products, null, 2) },
    { name: 'bouquets.csv', data: csv(products.map((p) => ({ id: p.id, name: p.name, category: p.category, price_rub: p.price, stock: p.stock, in_stock: p.in_stock, description: p.description }))) },
    { name: 'orders.json', data: JSON.stringify(orders, null, 2) },
    { name: 'orders.csv', data: csv(orders.map((o) => ({ id: o.id, created_at: o.created_at, status: o.status, payment: o.payment_status, customer: o.customer_name, phone: o.phone,
        address: o.address, date: o.delivery_date, time: o.delivery_time, items: itemsText(o), total_rub: o.total, delivery_rub: o.delivery_fee, rating: o.rating, review: o.review_text }))) },
    { name: 'messages.json', data: JSON.stringify(messages, null, 2) },
    { name: 'reminders.json', data: JSON.stringify(reminders, null, 2) },
    { name: 'settings.json', data: JSON.stringify(settings, null, 2) },
    { name: 'README.txt', data: `Резервная копия «Флёр» от ${stamp.replace('_', ' ')} (МСК).\n\nbouquets.csv и orders.csv открываются в Excel/Numbers.\nphotos/ — фото букетов (номер в начале — id товара).\n\nВ архиве телефоны и адреса покупателей — храните его у себя и не выкладывайте на GitHub.\n` },
  );
  return { buffer: zip(files), filename: `fleur-backup-${stamp}.zip`, photos: files.filter((f) => f.name.startsWith('photos/')).length };
}

module.exports = { makeBackup };
