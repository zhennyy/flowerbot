// Уведомления о заказе: «заказ принят» покупателю, «новый заказ» владелице, «заканчивается на складе»
const { orderText, escapeHtml } = require('../orders/texts');
const { orderKeyboard, statusButtons } = require('../bot/keyboards');
const { findProduct, lowStockLimit } = require('../catalog');
const payments = require('../payments/yookassa');
const { getOwnerId } = require('../owner');

async function notifyNewOrder(bot, order, paid = false) {
  await bot.telegram
    .sendMessage(order.user_id,
      `🌷 <b>Заказ №${order.id} ${paid ? 'оплачен и принят' : 'принят'}!</b>\nФлорист подтвердит его в ближайшее время.\n\n${orderText(order, false, false)}`,
      { parse_mode: 'HTML', ...(await orderKeyboard(order)) })
    .catch((sendError) => console.error('Не смогла написать покупателю:', sendError.message));
  const ownerId = getOwnerId();
  if (!ownerId) return;
  let paymentNote = '';
  if (paid) paymentNote = '💳 Оплачен онлайн';
  else if (payments.isEnabled()) {
    paymentNote = order.delivery_fee == null
      ? '⚠️ Доставка не рассчиталась (адрес не нашёлся на карте) — уточните стоимость и договоритесь об оплате'
      : '⚠️ Онлайн-оплата не создалась — договоритесь об оплате';
  }
  await bot.telegram
    .sendMessage(ownerId, `🔔 Новый заказ!${paymentNote ? '\n' + paymentNote : ''}\n\n${orderText(order, true)}`, { parse_mode: 'HTML', ...statusButtons(order.id) })
    .catch((sendError) => console.error('Не смогла написать владелице:', sendError.message));
}

// Остаток подходит к концу — предупреждаем владелицу (stockLeft — из createOrder)
async function notifyLowStock(bot, stockLeft) {
  const ownerId = getOwnerId();
  if (!ownerId) return;
  for (const productStock of stockLeft) {
    const product = await findProduct(productStock.id);
    if (!product || productStock.left > lowStockLimit(product)) continue;
    const text = productStock.left === 0
      ? `⛔️ «${escapeHtml(productStock.name)}» закончился — скрыт из витрины. Пополнить можно в /admin → Букеты`
      : `⚠️ «${escapeHtml(productStock.name)}»: осталось ${productStock.left} шт`;
    bot.telegram.sendMessage(ownerId, text, { parse_mode: 'HTML' }).catch(() => {});
  }
}

module.exports = { notifyNewOrder, notifyLowStock };
