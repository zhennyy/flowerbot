// Оценка ⭐ после доставки: 4–5 — спасибо и «повторить», 1–3 — просим рассказать, что пошло не так
const { Markup } = require('telegraf');
const { setRating, stars } = require('../../reviews');
const { findOwnOrder } = require('../../chat');
const { escapeHtml } = require('../../orders/texts');
const { shopUrl } = require('../links');
const { startWaiting } = require('../waiting');
const { getOwnerId } = require('../../owner');

const LOW_RATING = 3;

function registerReviewHandlers(bot) {
  bot.action(/^rate:(\d+):([1-5])$/, async (context) => {
    const order = await findOwnOrder(context.from.id, context.match[1]);
    if (!order) return context.answerCbQuery('Заказ не найден');
    const rating = Number(context.match[2]);
    await setRating(order.id, rating);
    await context.answerCbQuery('Спасибо!');
    await context.editMessageText(`Ваша оценка заказа №${order.id}: ${stars(rating)}`).catch(() => {});
    const ownerId = getOwnerId();
    if (ownerId) {
      bot.telegram.sendMessage(ownerId, `${stars(rating)} Оценка к заказу №${order.id} от ${escapeHtml(order.customer_name)}`, { parse_mode: 'HTML' }).catch(() => {});
    }
    if (rating <= LOW_RATING) {
      startWaiting(context.from.id, { type: 'review', orderId: order.id });
      return context.reply('Нам очень жаль 😔 Расскажите, что пошло не так — флорист обязательно прочитает');
    }
    return context.reply('Спасибо! Будем рады порадовать вас снова 💐', Markup.inlineKeyboard([
      [Markup.button.webApp('🔁 Повторить заказ', shopUrl({ repeat: order.id }))],
    ]));
  });
}

module.exports = { registerReviewHandlers };
