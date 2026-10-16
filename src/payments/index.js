// Онлайн-оплата заказа: создать платёж, принять уведомление ЮKassa, проверить неоплаченные.
// Покупатель платит до того, как флорист возьмётся за букет; без оплаты за 30 минут заказ отменяется,
// а если деньги всё же пришли позже — заказ возвращается в работу.
const { Markup } = require('telegraf');
const { database, toSqliteTimestamp, fromSqliteTimestamp } = require('../database');
const { findOrder, parseOrder, restock, setOrderStatus, setStatusMessage } = require('../orders');
const { orderText, formatRubles } = require('../orders/texts');
const { notifyNewOrder } = require('../notifications');
const { shopUrl } = require('../bot/links');
const { getOwnerId } = require('../owner');
const yookassa = require('./yookassa');

const PAY_TIMEOUT_MIN = 30;
const LATE_PAYMENT_WINDOW_MS = 864e5; // автоотменённые проверяем ещё сутки
const MINUTE_MS = 60000;

// ─── Состояние оплаты в заказе ───────────────────────────
// Каждая отметка срабатывает только из нужного состояния — повторное уведомление ничего не меняет.
// Возвращают true, если именно этот вызов поменял состояние.
const changePaymentStatus = async (orderId, fromStatuses, data) => {
  const { count } = await database.order.updateMany({
    where: { id: orderId, payment_status: { in: fromStatuses } },
    data,
  });
  return count === 1;
};
const markPaid = (orderId) =>
  changePaymentStatus(orderId, ['pending'], { payment_status: 'paid', paid_at: toSqliteTimestamp() });
const markPaymentCanceled = (orderId) => changePaymentStatus(orderId, ['pending'], { payment_status: 'canceled' });
// Оплата не пришла за 30 минут — заказ отменён, но платёж ещё может пройти (покупатель задержался на странице оплаты)
const markPaymentExpired = (orderId) => changePaymentStatus(orderId, ['pending'], { payment_status: 'expired' });
// Деньги пришли за отменённый заказ — возвращаем его в работу
const revivePaid = (orderId) =>
  changePaymentStatus(orderId, ['expired', 'canceled'], { payment_status: 'paid', paid_at: toSqliteTimestamp() });

// Все ждущие оплаты + сколько минут прошло с оформления
async function getUnpaidOrders(now = Date.now()) {
  const unpaidOrders = await database.order.findMany({ where: { payment_status: 'pending' }, orderBy: { id: 'asc' } });
  return unpaidOrders.map((order) => ({
    ...parseOrder(order),
    ageMinutes: (now - fromSqliteTimestamp(order.created_at)) / MINUTE_MS,
  }));
}

// Автоотменённые за последние сутки: вдруг оплата всё же прошла
async function getExpiredOrders(now = Date.now()) {
  const expiredOrders = await database.order.findMany({
    where: { payment_status: 'expired', created_at: { gte: toSqliteTimestamp(now - LATE_PAYMENT_WINDOW_MS) } },
    orderBy: { id: 'asc' },
  });
  return expiredOrders.map(parseOrder);
}

// Платёж прошёл и сумма совпадает с заказом (заказ в рублях, платёж — строкой «3490.00»)
const isPaidInFull = (payment, order) =>
  payment.status === 'succeeded' && Math.round(Number(payment.amount?.value)) === order.total;

// ─── Создание платежа ────────────────────────────────────
// Ссылка на оплату — покупателю в чат (кнопка «Оплатить») и в ответ витрине
async function startPayment(bot, order) {
  const payment = await yookassa.createPayment({
    orderId: order.id,
    amount: order.total,
    description: `Заказ №${order.id} в цветочной лавке «Флёр»`,
    returnUrl: `https://t.me/${bot.botInfo?.username || ''}`,
  });
  const paymentUrl = payment.confirmation.confirmation_url;
  await database.order.update({
    where: { id: order.id },
    data: { payment_id: payment.id, payment_status: 'pending', pay_url: paymentUrl },
  });
  const sentMessage = await bot.telegram
    .sendMessage(
      order.user_id,
      `🌷 <b>Заказ №${order.id} оформлен!</b>\nОсталось оплатить — после оплаты флорист сразу возьмётся за букет.\n\n${orderText(order, false)}`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([Markup.button.url(`💳 Оплатить ${formatRubles(order.total)}`, paymentUrl)]),
      },
    )
    .catch(() => null);
  if (sentMessage?.message_id) await setStatusMessage(order.id, sentMessage.message_id);
  return paymentUrl;
}

// ─── Что делаем, когда оплата пришла или не пришла ───────
async function onPaid(bot, orderId) {
  if (!(await markPaid(orderId))) return; // уже отмечен — повторное уведомление игнорируем
  let order = await findOrder(orderId);
  const ownerId = getOwnerId();
  if (order.status === 'cancelled') {
    // заказ отменили, а покупатель всё-таки оплатил — не теряем деньги
    await restock(order, -1);
    await setOrderStatus(orderId, 'new');
    order = await findOrder(orderId);
    if (ownerId) {
      bot.telegram
        .sendMessage(
          ownerId,
          `⚠️ Заказ №${order.id} был отменён, но покупатель его оплатил — вернула заказ в работу. Проверьте, есть ли цветы, или оформите возврат в ЮKassa.`,
        )
        .catch(() => {});
    }
  }
  if (order.status_msg_id) await bot.telegram.deleteMessage(order.user_id, order.status_msg_id).catch(() => {}); // убираем «Оплатить»
  await setStatusMessage(orderId, null);
  await notifyNewOrder(bot, { ...order, status_msg_id: null }, true);
}

async function onLatePaid(bot, orderId) {
  if (!(await revivePaid(orderId))) return;
  await restock(await findOrder(orderId), -1);
  await setOrderStatus(orderId, 'new');
  const order = await findOrder(orderId);
  await notifyNewOrder(bot, order, true);
  const ownerId = getOwnerId();
  if (ownerId) {
    bot.telegram
      .sendMessage(
        ownerId,
        `⚠️ Оплата по заказу №${order.id} пришла уже после автоотмены — заказ снова в работе. Проверьте наличие цветов.`,
      )
      .catch(() => {});
  }
}

async function onUnpaid(bot, orderId, reason, expired = false) {
  if (!(expired ? await markPaymentExpired(orderId) : await markPaymentCanceled(orderId))) return;
  const order = await findOrder(orderId);
  if (order.status !== 'cancelled') {
    await restock(order, +1);
    await setOrderStatus(orderId, 'cancelled');
  }
  if (order.status_msg_id) await bot.telegram.deleteMessage(order.user_id, order.status_msg_id).catch(() => {});
  await bot.telegram
    .sendMessage(
      order.user_id,
      `Заказ №${order.id} отменён: ${reason}.\nЕсли хотите — оформите заново, корзину можно повторить 🌷`,
      Markup.inlineKeyboard([Markup.button.webApp('🔁 Оформить заново', shopUrl({ repeat: order.id }))]),
    )
    .catch(() => {});
}

// ─── Уведомление ЮKassa ──────────────────────────────────
// Проверяем платёж у самой ЮKassa: уведомление может подделать кто угодно, а API — нет.
// Вебхук общий для нескольких ботов — берём только свои платежи (metadata.app) к своему заказу.
async function syncPayment(bot, paymentId) {
  const payment = await yookassa.getPayment(paymentId);
  const paymentApp = payment.metadata?.app;
  if (paymentApp && paymentApp !== yookassa.OUR_APP_ID) return 'чужой платёж';
  const orderId = Number(payment.metadata?.order_id);
  const order = Number.isSafeInteger(orderId) && orderId > 0 ? await findOrder(orderId) : null;
  if (!order || order.payment_id !== payment.id) return 'нет такого заказа';
  if (payment.status === 'succeeded' && !isPaidInFull(payment, order)) {
    console.warn(
      `ЮKassa: сумма платежа ${payment.amount?.value} не совпадает с заказом №${order.id} (${order.total} ₽)`,
    );
    return 'сумма не совпадает';
  }
  if (isPaidInFull(payment, order)) {
    if (order.payment_status === 'expired' || order.payment_status === 'canceled') await onLatePaid(bot, orderId);
    else await onPaid(bot, orderId);
  }
  if (payment.status === 'canceled') await onUnpaid(bot, orderId, 'оплата не прошла');
  return payment.status;
}

// ─── Проверка раз в минуту ───────────────────────────────
// Так оплата подтверждается за минуту даже без уведомлений (например, пока бот на ноутбуке),
// а заказы без оплаты дольше 30 минут отменяются, цветы возвращаются на склад.
async function checkUnpaidPayments(bot) {
  if (!yookassa.isEnabled()) return;
  for (const order of await getUnpaidOrders()) {
    try {
      const payment = await yookassa.getPayment(order.payment_id);
      if (isPaidInFull(payment, order)) await onPaid(bot, order.id);
      else if (payment.status === 'canceled') await onUnpaid(bot, order.id, 'оплата не прошла');
      else if (order.ageMinutes >= PAY_TIMEOUT_MIN)
        await onUnpaid(bot, order.id, `оплата не поступила за ${PAY_TIMEOUT_MIN} минут`, true);
    } catch (checkError) {
      console.error('Проверка оплаты:', checkError.message);
    }
  }
  for (const order of await getExpiredOrders()) {
    try {
      const payment = await yookassa.getPayment(order.payment_id);
      if (isPaidInFull(payment, order)) await onLatePaid(bot, order.id);
      else if (payment.status === 'canceled')
        await database.order.update({ where: { id: order.id }, data: { payment_status: 'canceled' } });
    } catch (checkError) {
      console.error('Проверка поздней оплаты:', checkError.message);
    }
  }
}

module.exports = {
  startPayment,
  syncPayment,
  checkUnpaidPayments,
  onPaid,
  onUnpaid,
  getUnpaidOrders,
  PAY_TIMEOUT_MIN,
  isEnabled: yookassa.isEnabled,
};
