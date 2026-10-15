// Даты в админке: «сегодня/завтра» по Москве, короткие подписи дней и время сообщений.

const MOSCOW_OFFSET_MS = 3 * 3600e3;
const DAY_MS = 864e5;
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Дата по Москве со сдвигом в днях: moscowDay(0) — сегодня, moscowDay(1) — завтра */
export const moscowDay = (dayShift = 0) =>
  new Date(Date.now() + MOSCOW_OFFSET_MS + dayShift * DAY_MS).toISOString().slice(0, 10);

/** «Сегодня», «Завтра», «Вчера» или «16 окт» */
export function niceDay(isoDate) {
  if (isoDate === moscowDay(0)) return 'Сегодня';
  if (isoDate === moscowDay(1)) return 'Завтра';
  if (isoDate === moscowDay(-1)) return 'Вчера';
  return `${Number(isoDate.slice(8))} ${MONTHS[Number(isoDate.slice(5, 7)) - 1]}`;
}

/** «18:00–21:00» → «18–21» */
export const niceTime = (timeRange) => timeRange.replace(/:00/g, '');

// Время из базы — UTC в виде «2026-10-14 09:15:00»
const parseDatabaseTime = (databaseTime) => new Date(databaseTime.replace(' ', 'T') + 'Z');
/** «09:15» по времени телефона */
export const timeOf = (databaseTime) =>
  parseDatabaseTime(databaseTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
/** «14 октября» */
export const dayOf = (databaseTime) =>
  parseDatabaseTime(databaseTime).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
/** Сейчас в формате базы */
export const nowAsDatabaseTime = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
