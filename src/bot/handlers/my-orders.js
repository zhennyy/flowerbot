// «Мои заказы» в чате: последние 5 заказов с кнопками «Повторить» и «Вопрос»
const { Markup } = require('telegraf');
const { getUserOrders } = require('../../orders');
const { orderText } = require('../../orders/texts');
const { shopUrl } = require('../links');

const ORDERS_IN_CHAT = 5;
const USER_ORDERS_LIMIT = 10;

async function sendMyOrders(context) {
  const latestOrders = (await getUserOrders(context.from.id, USER_ORDERS_LIMIT)).slice(0, ORDERS_IN_CHAT);
  if (!latestOrders.length) {
    return context.reply('У вас пока нет заказов 🌿', Markup.inlineKeyboard([Markup.button.webApp('💐 Открыть магазин', shopUrl())]));
  }
  for (const order of latestOrders.reverse()) { // старые сверху, свежий — последним, у поля ввода
    const keyboard = [[Markup.button.webApp('🔁 Повторить', shopUrl({ repeat: order.id })), Markup.button.callback('💬 Вопрос', `ask:${order.id}`)]];
    await context.reply(orderText(order), { parse_mode: 'HTML', ...Markup.inlineKeyboard(keyboard) });
  }
  return undefined;
}

function registerMyOrdersHandlers(bot) {
  bot.command('orders', sendMyOrders);
  bot.action('my_orders', async (context) => {
    await context.answerCbQuery();
    return sendMyOrders(context);
  });
}

module.exports = { registerMyOrdersHandlers, sendMyOrders };
