// Запросы к API витрины (/api/...). Подписанные запросы несут данные Telegram в заголовке X-Init-Data —
// по ним сервер узнаёт покупателя. Ответ (Response) разбирает вызывающий: у каждого запроса своя реакция на ошибку.
import { telegramInitData } from '../shared/telegram.js';

/**
 * path — без /api; body — объект (уйдёт POST-ом в JSON); signed — добавить подпись Telegram.
 * Заголовок ngrok-skip-browser-warning убирает страницу-предупреждение ngrok при тесте с компьютера.
 */
export function requestShopApi(path, { body, signed = false } = {}) {
  const headers = {
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(signed ? { 'X-Init-Data': telegramInitData() } : {}),
    'ngrok-skip-browser-warning': '1',
  };
  return fetch('/api' + path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined });
}

/** GET без подписи → JSON (каталог, тарифы доставки, интервалы) */
export const getPublicJson = async (path) => (await requestShopApi(path)).json();
