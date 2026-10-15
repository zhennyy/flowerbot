// Запросы к API админки (/api/admin/...): все подписаны данными Telegram — сервер проверит, что это именно владелица.
// Нет доступа (401/403) — вместо админки показываем замок и больше ничего не запрашиваем.
import { escapeHtml } from '../shared/dom.js';
import { telegramInitData } from '../shared/telegram.js';

let accessDenied = false;

/** Доступ запрещён — опросы по таймеру больше не нужны (и элементов страницы уже нет) */
export const isAccessDenied = () => accessDenied;

export function showAccessDenied(message) {
  accessDenied = true;
  document.body.innerHTML = `<div class="denied">🔒<br>${escapeHtml(message || 'Нет доступа')}<br>Откройте админку командой /admin в боте</div>`;
}

const adminHeaders = () => ({
  'Content-Type': 'application/json',
  'X-Init-Data': telegramInitData(),
  'ngrok-skip-browser-warning': '1',
});

/** method: GET (по умолчанию) | POST | PUT | DELETE; body — объект, уйдёт в JSON. Возвращает JSON ответа или бросает Error с текстом */
export async function callAdminApi(path, { method, body } = {}) {
  const response = await fetch('/api/admin' + path, {
    method,
    headers: adminHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    showAccessDenied(data.error);
    throw new Error(data.error);
  }
  if (!response.ok) throw new Error(data.error || 'Ошибка сервера');
  return data;
}

// Фото из Telegram (переписка, фото букета) грузим через сервер с подписью — просто <img src> не пройдёт проверку
const photoUrlCache = {};

/** Подставляет фото в <img data-photo="file_id">; не загрузилось — вместо картинки надпись */
export async function loadTelegramPhoto(image) {
  const fileId = image.dataset.photo;
  try {
    photoUrlCache[fileId] ||= await fetch(`/api/admin/photo/${encodeURIComponent(fileId)}`, {
      headers: { 'X-Init-Data': telegramInitData(), 'ngrok-skip-browser-warning': '1' },
    })
      .then((response) => (response.ok ? response.blob() : Promise.reject()))
      .then((blob) => URL.createObjectURL(blob));
    image.src = photoUrlCache[fileId];
  } catch {
    image.replaceWith('📷 фото');
  }
}

export const loadTelegramPhotosIn = (container) =>
  container.querySelectorAll('img[data-photo]').forEach(loadTelegramPhoto);
