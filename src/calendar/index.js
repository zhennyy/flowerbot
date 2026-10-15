// Календарь доставки: даты и часы по Москве, интервалы, выходные дни и лимит заказов на интервал (настраивается в админке)
const { getSetting } = require('../settings');
const { countSlotOrders } = require('../orders');

const MOSCOW_OFFSET_MS = 3 * 3600e3;
const DAY_MS = 864e5;
const TIME_SLOTS = ['09:00–12:00', '12:00–15:00', '15:00–18:00', '18:00–21:00'];
const DEFAULT_CALENDAR = { closed: [], slotLimit: 0 }; // slotLimit 0 = без лимита
// Сегодня интервал должен закончиться хотя бы через час (по Москве) — иначе не успеем собрать и довезти
const SAME_DAY_MARGIN_HOURS = 1;

// Дата по Москве «2026-10-14»: сегодня, завтра (plusDays = 1)…
const moscowDate = (plusDays = 0, now = Date.now()) =>
  new Date(now + MOSCOW_OFFSET_MS + plusDays * DAY_MS).toISOString().slice(0, 10);
const moscowHour = (now = Date.now()) => new Date(now + MOSCOW_OFFSET_MS).getUTCHours();

// «2026-02-31» тоже похоже на дату — проверяем, что такой день есть в календаре
const isCalendarDate = (isoDate) =>
  /^\d{4}-\d{2}-\d{2}$/.test(isoDate) && new Date(isoDate + 'T00:00:00Z').toISOString().slice(0, 10) === isoDate;

const getCalendar = () => getSetting('calendar', DEFAULT_CALENDAR);

// Интервалы на дату: свободен ли и сколько мест осталось (null — без лимита)
async function slotsFor(isoDate) {
  const calendar = await getCalendar();
  const closed = calendar.closed.includes(isoDate);
  const slots = [];
  for (const time of TIME_SLOTS) {
    const taken = calendar.slotLimit ? await countSlotOrders(isoDate, time) : 0;
    const left = calendar.slotLimit ? Math.max(0, calendar.slotLimit - taken) : null;
    slots.push({ time, available: !closed && (left === null || left > 0), left });
  }
  return { closed, slots };
}

// Можно ли привезти в этот день и интервал. Возвращает текст ошибки для покупателя или null.
async function checkDeliverySlot(isoDate, deliveryTime, now = Date.now()) {
  if (!isCalendarDate(isoDate)) return 'Выберите дату доставки';
  if (isoDate < moscowDate(0, now)) return 'Дата доставки уже прошла';
  if (!TIME_SLOTS.includes(deliveryTime)) return 'Выберите время доставки';
  const slotEndHour = parseInt(deliveryTime.split('–')[1], 10);
  if (isoDate === moscowDate(0, now) && slotEndHour <= moscowHour(now) + SAME_DAY_MARGIN_HOURS) {
    return 'На этот интервал уже не успеем 🙈 Выберите время попозже';
  }
  const day = await slotsFor(isoDate);
  if (day.closed) return 'В этот день мы не работаем 🌿 Выберите другую дату';
  if (!day.slots.find((slot) => slot.time === deliveryTime).available)
    return 'На это время заказов уже много 🙈 Выберите другой интервал';
  return null;
}

module.exports = {
  TIME_SLOTS,
  DEFAULT_CALENDAR,
  moscowDate,
  moscowHour,
  isCalendarDate,
  getCalendar,
  slotsFor,
  checkDeliverySlot,
};
