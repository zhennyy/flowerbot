// Отзывы ⭐ после доставки: через 2 часа после «Доставлен» спрашиваем оценку
const { Markup } = require('telegraf');
const { database, toSqliteTimestamp } = require('../database');
const { parseOrder } = require('../orders');

const REVIEW_DELAY_MIN = 120; // через сколько минут после «Доставлен» спросить отзыв
const MINUTE_MS = 60000;
const MAX_REVIEW_LENGTH = 1000;

const stars = (rating) => '⭐'.repeat(rating);

// Доставленные заказы, где прошло delayMinutes минут и отзыв ещё не спрашивали
async function getOrdersForReview(delayMinutes = REVIEW_DELAY_MIN, now = Date.now()) {
  const deliveredOrders = await database.order.findMany({
    where: { status: 'done', review_asked: 0, done_at: { lte: toSqliteTimestamp(now - delayMinutes * MINUTE_MS) } },
    orderBy: { id: 'asc' },
  });
  return deliveredOrders.map(parseOrder);
}

const setRating = (orderId, rating) => database.order.update({ where: { id: orderId }, data: { rating } });
const setReviewText = (orderId, reviewText) =>
  database.order.update({ where: { id: orderId }, data: { review_text: reviewText.slice(0, MAX_REVIEW_LENGTH) } });

async function askReview(bot, order) {
  await database.order.update({ where: { id: order.id }, data: { review_asked: 1 } });
  await bot.telegram
    .sendMessage(
      order.user_id,
      `Как вам букет по заказу №${order.id}? 🌷\nОцените, пожалуйста — это очень помогает нам`,
      {
        ...Markup.inlineKeyboard([
          [1, 2, 3, 4, 5].map((rating) => Markup.button.callback(`${rating} ⭐`, `rate:${order.id}:${rating}`)),
        ]),
      },
    )
    .catch((sendError) => console.error('Отзыв:', sendError.message));
}

async function askDueReviews(bot) {
  for (const order of await getOrdersForReview()) await askReview(bot, order);
}

module.exports = {
  REVIEW_DELAY_MIN,
  MAX_REVIEW_LENGTH,
  stars,
  getOrdersForReview,
  setRating,
  setReviewText,
  askReview,
  askDueReviews,
};
