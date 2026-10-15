// Переписка покупатель ⇄ флорист через бота (без раскрытия контактов).
// Ответ флориста нужен и боту, и админке, поэтому лежит здесь, а не в обработчиках чата.
const { findOrder } = require('../orders');
const { escapeHtml } = require('../orders/texts');
const messages = require('./messages');

const MAX_MESSAGE_LENGTH = 3000;

// Как зовут человека в Telegram
const customerName = (telegramUser) =>
  `${telegramUser.first_name || ''} ${telegramUser.last_name || ''}`.trim() || 'Покупатель';

// Заказ принадлежит этому покупателю? (чужой заказ кнопкой не поменять)
async function findOwnOrder(userId, orderId) {
  const order = await findOrder(Number(orderId));
  return order && String(order.user_id) === String(userId) ? order : null;
}

// Ответ флориста покупателю — из чата бота или из админки
async function sendToBuyer(bot, userId, text, orderId = null) {
  await bot.telegram.sendMessage(
    userId,
    `💬 <b>Флорист «Флёр»</b>${orderId ? ` · заказ №${orderId}` : ''}:\n\n${escapeHtml(text.slice(0, MAX_MESSAGE_LENGTH))}`,
    { parse_mode: 'HTML' },
  );
  await messages.saveMessage({
    user_id: userId,
    order_id: orderId || null,
    direction: 'out',
    text: text.slice(0, MAX_MESSAGE_LENGTH),
    is_read: 1,
  });
}

module.exports = { sendToBuyer, customerName, findOwnOrder, MAX_MESSAGE_LENGTH };
