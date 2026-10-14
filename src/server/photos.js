// Фото букетов.
// uploads — загруженные из админки (на сервере /data/flowerbot/uploads, DATA_DIR=/data/flowerbot — переживают обновления);
// public/photos — фото в проекте (видно в VS Code и на GitHub): файл «<id товара>-название.jpg» один раз ставится товару.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { dataDirectory, PROJECT_DIR } = require('../database');
const { setProductPhoto } = require('../catalog');
const { getSetting, setSetting } = require('../settings');

const uploadsDir = path.join(dataDirectory, 'uploads');
const photosDir = path.join(PROJECT_DIR, 'public', 'photos');
const MIN_PHOTO_BYTES = 100;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PROJECT_PHOTO_PATTERN = /^(\d+)-[\w.-]+\.(jpe?g|png|webp)$/i;

const userError = (message) => Object.assign(new Error(message), { expose: true });

// Фото из папки проекта ставится товару один раз (отметка photo_applied:<файл> в настройках);
// если потом заменить фото в админке — при следующем запуске оно не перезапишется
async function assignProjectPhotos() {
  if (!fs.existsSync(photosDir)) return;
  for (const fileName of fs.readdirSync(photosDir)) {
    const fileMatch = fileName.match(PROJECT_PHOTO_PATTERN);
    if (!fileMatch || (await getSetting(`photo_applied:${fileName}`, null))) continue;
    if (await setProductPhoto(Number(fileMatch[1]), `/photos/${fileName}`)) console.log(`📷 Фото из проекта: ${fileName}`);
    await setSetting(`photo_applied:${fileName}`, new Date().toISOString());
  }
}

// Админка сама сжимает картинку и присылает JPEG в base64 (data:image/jpeg;base64,…)
function decodeJpeg(base64Photo) {
  const photoBuffer = Buffer.from(String(base64Photo || '').replace(/^data:image\/jpeg;base64,/, ''), 'base64');
  const isJpeg = photoBuffer.length >= MIN_PHOTO_BYTES && photoBuffer[0] === 0xff && photoBuffer[1] === 0xd8;
  if (!isJpeg) throw userError('Это не похоже на фото (нужен JPEG)');
  if (photoBuffer.length > MAX_PHOTO_BYTES) throw userError('Фото слишком большое');
  return photoBuffer;
}

// Большое фото и миниатюра под одним случайным именем; в каталог идёт ссылка на миниатюру
function saveUploadedPhoto(fullPhoto, thumbnailPhoto) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const fileName = crypto.randomUUID();
  fs.writeFileSync(path.join(uploadsDir, fileName + '.jpg'), fullPhoto);
  fs.writeFileSync(path.join(uploadsDir, fileName + '_min.jpg'), thumbnailPhoto);
  return `/uploads/${fileName}_min.jpg`;
}

module.exports = { uploadsDir, photosDir, assignProjectPhotos, decodeJpeg, saveUploadedPhoto, MAX_PHOTO_BYTES };
