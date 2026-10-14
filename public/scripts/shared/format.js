// Форматирование для показа: рубли, слова после чисел, даты.

/** 12345 → «12 345 ₽» */
export const formatRubles = (amount) => Number(amount).toLocaleString('ru-RU') + ' ₽';

/** Слово в нужной форме после числа: pluralize(3, ['букет', 'букета', 'букетов']) → «букета» */
export function pluralize(count, [one, few, many]) {
  const lastDigit = count % 10;
  const lastTwoDigits = count % 100;
  if (lastDigit === 1 && lastTwoDigits !== 11) return one;
  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)) return few;
  return many;
}

/** «2026-10-14» → «14.10.2026» */
export const formatDate = (isoDate) => isoDate.split('-').reverse().join('.');

/** Километры с запятой: 1.5 → «1,5» */
export const formatKilometers = (kilometers) => String(kilometers).replace('.', ',');
