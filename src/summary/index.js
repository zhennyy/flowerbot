// Сводка для владелицы: что везём сегодня/завтра, непрочитанные сообщения, что заканчивается.
// Уходит в Telegram — поэтому без адресов и контактов покупателей (152-ФЗ), только зона доставки
const { STATUSES, getOrdersForDate } = require('../orders');
const { escapeHtml, formatDate } = require('../orders/texts');
const { getLowStock } = require('../catalog');
const { countUnread } = require('../chat/messages');
const { getSetting, setSetting } = require('../settings');
const { moscowDate, moscowHour } = require('../calendar');
const { adminKeyboard } = require('../bot/keyboards');
const { getOwnerId } = require('../owner');

const MORNING_SUMMARY_HOUR = 9;

// 1 доставка, 2–4 доставки, 5+ доставок
const deliveriesWord = (count) => (count === 1 ? 'доставка' : count < 5 ? 'доставки' : 'доставок');

async function summaryText(isoDate, title) {
  const dayOrders = await getOrdersForDate(isoDate);
  const lines = [`${title} — ${formatDate(isoDate)}`, ''];
  if (!dayOrders.length) lines.push('Доставок нет 🌿');
  for (const order of dayOrders) {
    lines.push(`<b>${order.delivery_time}</b> · №${order.id} ${STATUSES[order.status].split(' ')[0]}`);
    lines.push(`   ${order.items.map((orderItem) => `${escapeHtml(orderItem.name)} ×${orderItem.qty}`).join(', ')}`);
    lines.push(
      `   🚚 ${escapeHtml(order.delivery_zone || 'зона уточняется')}${order.card_text ? ' · 💌 открытка' : ''}`,
    );
  }
  if (dayOrders.length) {
    const dayTotal = dayOrders.reduce((sum, order) => sum + order.total, 0);
    lines.push(
      '',
      `Итого: ${dayOrders.length} ${deliveriesWord(dayOrders.length)} на ${dayTotal.toLocaleString('ru-RU')} ₽`,
      'Адреса и контакты — в админке',
    );
  }
  const unreadCount = await countUnread();
  if (unreadCount) lines.push(`💬 Непрочитанных сообщений: ${unreadCount}`);
  const lowStock = await getLowStock();
  if (lowStock.length)
    lines.push(
      '',
      '⚠️ Заканчивается:',
      ...lowStock.map((product) => `   ${escapeHtml(product.name)} — ${product.stock} шт`),
    );
  return lines.join('\n');
}

// Утренняя сводка в 9:00 по Москве — один раз в день (отметка в настройках summary_sent)
async function sendMorningSummary(bot) {
  const ownerId = getOwnerId();
  if (!ownerId || moscowHour() < MORNING_SUMMARY_HOUR || (await getSetting('summary_sent', '')) === moscowDate())
    return;
  await setSetting('summary_sent', moscowDate());
  await bot.telegram
    .sendMessage(ownerId, await summaryText(moscowDate(), '☀️ Доброе утро! Сегодня'), {
      parse_mode: 'HTML',
      ...adminKeyboard(),
    })
    .catch((sendError) => console.error('Сводка:', sendError.message));
}

module.exports = { summaryText, sendMorningSummary };
