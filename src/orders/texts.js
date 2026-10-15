// Тексты о заказе для Telegram: чек для покупателя и владелицы, короткие сообщения о смене статуса
const { STATUSES } = require('./index');
const { moscowDate } = require('../calendar');

// Экранируем текст для сообщений Telegram в режиме HTML (чтобы «<» в открытке ничего не сломал)
const escapeHtml = (text = '') => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const formatRubles = (amount) => amount.toLocaleString('ru-RU') + ' ₽';
// «2026-10-01» → «01.10.2026»
const formatDate = (isoDate) => isoDate.split('-').reverse().join('.');

// «Сегодня, 18–21» вместо «01.10.2026, 18:00–21:00»
const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];
const niceDay = (isoDate) => {
  if (isoDate === moscowDate(0)) return 'Сегодня';
  if (isoDate === moscowDate(1)) return 'Завтра';
  return `${+isoDate.slice(8)} ${MONTHS[+isoDate.slice(5, 7) - 1]}`;
};
// «18:00–21:00» → «с 18:00 до 21:00»
const slotText = (deliveryTime) => {
  const [slotStart, slotEnd] = String(deliveryTime || '').split(/[–-]/);
  return slotEnd ? `с ${slotStart.trim()} до ${slotEnd.trim()}` : String(deliveryTime || '');
};
const niceWhen = (order) => `${niceDay(order.delivery_date)} ${slotText(order.delivery_time)}`;
const shortWhen = (order) => `${niceDay(order.delivery_date)}, ${order.delivery_time.replace(/:00/g, '')}`; // компактно — для витрины
// «🆕 Новый» → «Новый»
const statusLabel = (status) => STATUSES[status].replace(/^\S+\s/, '');

// Текст заказа — спокойный, без лишних эмодзи: что, когда, куда, сколько
function orderText(order, forOwner = false, withHeader = true) {
  const lines = [];
  if (withHeader) lines.push(`<b>Заказ №${order.id}</b> · ${statusLabel(order.status)}`);
  lines.push(`🕒 ${niceWhen(order)}`, `📍 ${escapeHtml(order.address)}`, '');
  for (const orderItem of order.items) {
    const quantityText = orderItem.qty > 1 || orderItem.unit ? ` × ${orderItem.qty}${orderItem.unit ? ' шт' : ''}` : '';
    lines.push(`${escapeHtml(orderItem.name)}${quantityText} — ${formatRubles(orderItem.price * orderItem.qty)}`);
  }
  lines.push(
    order.delivery_fee == null
      ? 'Доставка — уточним'
      : `Доставка — ${order.delivery_fee ? formatRubles(order.delivery_fee) : 'бесплатно'}`,
  );
  lines.push(`<b>Итого ${formatRubles(order.total)}</b>`);
  const extraLines = [];
  if (order.recipient) extraLines.push(`🎁 ${escapeHtml(order.recipient)}`);
  if (order.card_text) extraLines.push(`💌 «${escapeHtml(order.card_text)}»`);
  if (order.comment) extraLines.push(`💬 ${escapeHtml(order.comment)}`);
  if (forOwner)
    extraLines.push(
      `👤 ${escapeHtml(order.customer_name)}${order.username ? ' @' + escapeHtml(order.username) : ''} · ${escapeHtml(order.phone)}`,
    );
  if (extraLines.length) lines.push('', ...extraLines);
  return lines.join('\n');
}

// Трекер этапов: ✔ пройдено, ▸ сейчас, ○ впереди
// [статус, как звучит сейчас, как звучит когда пройден]
const STEPS = [
  ['new', 'Принят', 'Принят'],
  ['confirmed', 'Подтверждён', 'Подтверждён'],
  ['assembling', 'Собираем букет', 'Букет собран'],
  ['delivering', 'В пути', 'Доставка'],
  ['done', 'Доставлен', 'Доставлен'],
];
function tracker(status) {
  const currentStep = STEPS.findIndex(([stepStatus]) => stepStatus === status);
  return STEPS.map(([, nowText, pastText], stepIndex) => {
    if (stepIndex < currentStep) return `✔︎  ${pastText}`;
    if (stepIndex === currentStep) return `▸  <b>${nowText}</b>`;
    return `○  ${nowText}`;
  }).join('\n');
}

// Сообщение покупателю о смене статуса: заголовок, тёплая фраза, трекер, детали — без повтора всего чека
function statusNote(order) {
  const when = niceWhen(order).replace(/^Сегодня|^Завтра/, (dayWord) => dayWord.toLowerCase());
  const [title, phrase] = {
    new: ['🕊 Заказ снова в обработке', 'Скоро всё подтвердим'],
    confirmed: ['✅ Заказ подтверждён!', `Ждите букет ${when} 🌷`],
    assembling: [
      '💐 Флорист собирает ваш букет',
      'Подбираем самые свежие цветы — с любовью и вниманием к каждой веточке',
    ],
    delivering: ['🚚 Курьер уже в пути!', 'Совсем скоро букет будет у вас. Держите телефон рядом 📱'],
    done: ['🌷 Букет доставлен!', 'Надеемся, он подарил много радости. Спасибо, что выбрали «Флёр» ❤️'],
    cancelled: ['Заказ отменён', 'Если это ошибка или хотите что-то изменить — просто напишите нам сюда'],
  }[order.status];
  const lines = [`<b>${title}</b>`, phrase, ''];
  if (order.status !== 'cancelled') lines.push(tracker(order.status), '');
  lines.push(`📦 Заказ №${order.id}`, `🕒 ${niceWhen(order)}`);
  if (order.status === 'delivering') lines.push(`📍 ${escapeHtml(order.address)}`);
  return lines.join('\n');
}

module.exports = {
  escapeHtml,
  formatRubles,
  formatDate,
  niceDay,
  slotText,
  niceWhen,
  shortWhen,
  statusLabel,
  orderText,
  tracker,
  statusNote,
};
