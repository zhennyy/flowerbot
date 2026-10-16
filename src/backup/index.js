// Резервная копия «Флёра» одним ZIP-архивом (без сторонних библиотек).
// Внутри: букеты, заказы, отзывы, переписка, напоминания, настройки (JSON и CSV для Excel) и фото.
// Архив уходит владелице через Telegram (зарубежный сервис), поэтому в нём нет персональных данных покупателей
// (152-ФЗ): имени, телефона, адреса, получателя и комментария к заказу. Полная копия — ночной бэкап на сервере.
const fs = require('node:fs');
const path = require('node:path');
const { database } = require('../database');

// ---- минимальный ZIP (метод «хранение»: фото и так сжаты) ----
const CRC_TABLE = new Uint32Array(256).map((_, tableIndex) => {
  let crcValue = tableIndex;
  for (let bit = 0; bit < 8; bit++) crcValue = crcValue & 1 ? 0xedb88320 ^ (crcValue >>> 1) : crcValue >>> 1;
  return crcValue >>> 0;
});

function crc32(buffer) {
  let crcValue = 0xffffffff;
  for (const byte of buffer) crcValue = CRC_TABLE[(crcValue ^ byte) & 255] ^ (crcValue >>> 8);
  return (crcValue ^ 0xffffffff) >>> 0;
}

function createZip(files) {
  const localParts = [];
  const centralDirectory = [];
  let offset = 0;
  for (const file of files) {
    const fileName = Buffer.from(file.name, 'utf8');
    const fileData = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const checksum = crc32(fileData);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6); // utf-8 имена
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(fileData.length, 18);
    localHeader.writeUInt32LE(fileData.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    localParts.push(localHeader, fileName, fileData);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(fileData.length, 20);
    centralHeader.writeUInt32LE(fileData.length, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    centralDirectory.push(centralHeader, fileName);
    offset += localHeader.length + fileName.length + fileData.length;
  }
  const centralDirectoryBuffer = Buffer.concat(centralDirectory);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(centralDirectoryBuffer.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectoryBuffer, endRecord]);
}

// CSV для Excel: «;» и BOM — чтобы Excel на Mac/Windows сразу открыл кириллицу по столбцам
function toCsv(rows) {
  if (!rows.length) return '';
  const columnNames = Object.keys(rows[0]);
  const formatCell = (value) => {
    let cellText = value == null ? '' : String(value);
    const looksLikeFormula =
      typeof value === 'string' && /^[-=+@\t\r]/.test(cellText) && !/^[+-]?[\d\s().-]+$/.test(cellText); // телефоны не трогаем
    if (looksLikeFormula) cellText = "'" + cellText;
    return /[";\n]/.test(cellText) ? `"${cellText.replace(/"/g, '""')}"` : cellText;
  };
  return (
    '﻿' +
    [
      columnNames.join(';'),
      ...rows.map((row) => columnNames.map((columnName) => formatCell(row[columnName])).join(';')),
    ].join('\n')
  );
}

// Путь к файлу фото, если ссылка ведёт на наше фото (/uploads/… или /photos/…) и файл на месте
function findPhotoFile(photoUrl, directories) {
  const photoMatch = String(photoUrl || '').match(/\/(uploads|photos)\/([^/?#]+)$/);
  if (!photoMatch || !/^\/(uploads|photos)\//.test(String(photoUrl))) return null;
  const filePath = path.join(directories[photoMatch[1]], photoMatch[2]);
  return fs.existsSync(filePath) ? { fileName: photoMatch[2], filePath } : null;
}

// «Утро в Провансе (M) × 1, Роза красная, 60 см × 11»
function orderItemsText(order) {
  try {
    return JSON.parse(order.items)
      .map((orderItem) => `${orderItem.name}${orderItem.size ? ' (' + orderItem.size + ')' : ''} × ${orderItem.qty}`)
      .join(', ');
  } catch {
    return '';
  }
}

// Поля заказа с персональными данными покупателя — в архив для Telegram не попадают
const PERSONAL_ORDER_FIELDS = ['customer_name', 'phone', 'address', 'recipient', 'comment'];
const withoutPersonalData = (order) =>
  Object.fromEntries(Object.entries(order).filter(([fieldName]) => !PERSONAL_ORDER_FIELDS.includes(fieldName)));

async function makeBackup({ uploadsDir, photosDir }) {
  const products = await database.product.findMany({ orderBy: { id: 'asc' } });
  const allOrders = (await database.order.findMany({ orderBy: { id: 'asc' } })).map(withoutPersonalData);
  // имя из Telegram в переписке тоже не нужно — покупателя видно по user_id
  const messages = (await database.message.findMany({ orderBy: { id: 'asc' } })).map(
    ({ name: _name, ...message }) => message,
  );
  const reminders = await database.reminder.findMany({ orderBy: { id: 'asc' } });
  // служебные отметки «фото из проекта уже поставлено» в архиве не нужны
  const settings = (await database.setting.findMany()).filter((setting) => !setting.key.startsWith('photo_applied:'));

  const archiveFiles = [];
  const photoDirectories = { uploads: uploadsDir, photos: photosDir };
  for (const product of products) {
    const photoFile = findPhotoFile(product.photo_url, photoDirectories);
    if (!photoFile) continue;
    const archiveName = photoFile.fileName.startsWith(product.id + '-')
      ? photoFile.fileName
      : `${product.id}-${photoFile.fileName}`;
    archiveFiles.push({ name: `photos/${archiveName}`, data: fs.readFileSync(photoFile.filePath) });
  }
  const timestamp = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  const bouquetRows = products.map((product) => ({
    id: product.id,
    name: product.name,
    category: product.category,
    price_rub: product.price,
    stock: product.stock,
    in_stock: product.in_stock,
    description: product.description,
  }));
  const orderRows = allOrders.map((order) => ({
    id: order.id,
    created_at: order.created_at,
    status: order.status,
    payment: order.payment_status,
    date: order.delivery_date,
    time: order.delivery_time,
    items: orderItemsText(order),
    total_rub: order.total,
    delivery_rub: order.delivery_fee,
    rating: order.rating,
    review: order.review_text,
  }));
  archiveFiles.push(
    { name: 'bouquets.json', data: JSON.stringify(products, null, 2) },
    { name: 'bouquets.csv', data: toCsv(bouquetRows) },
    { name: 'orders.json', data: JSON.stringify(allOrders, null, 2) },
    { name: 'orders.csv', data: toCsv(orderRows) },
    { name: 'messages.json', data: JSON.stringify(messages, null, 2) },
    { name: 'reminders.json', data: JSON.stringify(reminders, null, 2) },
    { name: 'settings.json', data: JSON.stringify(settings, null, 2) },
    {
      name: 'README.txt',
      data: `Резервная копия «Флёр» от ${timestamp.replace('_', ' ')} (МСК).\n\nbouquets.csv и orders.csv открываются в Excel/Numbers.\nphotos/ — фото букетов (номер в начале — id товара).\n\nПерсональных данных покупателей (имя, телефон, адрес, получатель, комментарий) в архиве нет — по 152-ФЗ они хранятся только на сервере в России. Полная копия базы — в ночном резервном копировании сервера.\n`,
    },
  );
  return {
    buffer: createZip(archiveFiles),
    filename: `fleur-backup-${timestamp}.zip`,
    photos: archiveFiles.filter((archiveFile) => archiveFile.name.startsWith('photos/')).length,
  };
}

module.exports = { makeBackup, createZip, toCsv };
