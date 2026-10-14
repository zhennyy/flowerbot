// Заказы: создание со списанием остатков, статусы, склад при отмене, выборки для админки, сводки и календаря
const { database, runInTransaction, toSqliteTimestamp, fromSqliteTimestamp } = require('../database');

// Статусы заказа и как они звучат для людей
const STATUSES = {
  new: '🆕 Новый',
  confirmed: '✅ Подтверждён',
  assembling: '💐 Собираем букет',
  delivering: '🚚 В пути',
  done: '🌷 Доставлен',
  cancelled: '❌ Отменён',
};

const MOSCOW_OFFSET_MS = 3 * 3600e3;
const DAY_MS = 864e5;
const RECENT_ORDERS_LIMIT = 50;

// Состав заказа хранится JSON-строкой — наружу отдаём массивом
const parseOrder = (order) => order && { ...order, items: JSON.parse(order.items) };

async function findOrder(orderId) {
  if (!Number.isSafeInteger(orderId)) return null;
  return parseOrder(await database.order.findUnique({ where: { id: orderId } }));
}

async function getRecentOrders(limit = RECENT_ORDERS_LIMIT) {
  return (await database.order.findMany({ orderBy: { id: 'desc' }, take: limit })).map(parseOrder);
}

async function getUserOrders(userId, limit) {
  return (await database.order.findMany({ where: { user_id: Number(userId) }, orderBy: { id: 'desc' }, take: limit })).map(parseOrder);
}

// Заказ + списание остатков — одной транзакцией: либо всё, либо ничего.
// Возвращает id заказа и сколько осталось у товаров с учётом остатка (для предупреждения «заканчивается»).
function createOrder(orderData) {
  return runInTransaction(async () => {
    const stockLeft = [];
    for (const orderItem of orderData.items) {
      const product = await database.product.findUnique({ where: { id: orderItem.id }, select: { name: true, stock: true } });
      if (product && product.stock != null) {
        if (product.stock < orderItem.qty) throw Object.assign(new Error(`«${product.name}»: осталось только ${product.stock} шт`), { expose: true });
        await database.product.update({ where: { id: orderItem.id }, data: { stock: { decrement: orderItem.qty } } });
        stockLeft.push({ id: orderItem.id, name: product.name, left: product.stock - orderItem.qty });
      }
    }
    const createdOrder = await database.order.create({ data: { ...orderData, items: JSON.stringify(orderData.items) }, select: { id: true } });
    return { id: createdOrder.id, stockLeft };
  });
}

// Отмена возвращает цветы на склад (direction = +1), «отмена отмены» — снова списывает (direction = -1).
// Остаток не уходит ниже нуля; товары без учёта остатка не трогаем.
function restock(order, direction) {
  return runInTransaction(async () => {
    for (const orderItem of order.items) {
      await database.product.updateMany({ where: { id: orderItem.id, stock: { not: null } }, data: { stock: { increment: direction * orderItem.qty } } });
      await database.product.updateMany({ where: { id: orderItem.id, stock: { lt: 0 } }, data: { stock: 0 } });
    }
  });
}

// Смена статуса; время доставки запоминаем один раз — от него считаем, когда спросить отзыв
async function setOrderStatus(orderId, status) {
  await database.order.update({ where: { id: orderId }, data: { status } });
  if (status === 'done') await database.order.updateMany({ where: { id: orderId, done_at: null }, data: { done_at: toSqliteTimestamp() } });
}

const setStatusMessage = (orderId, messageId) => database.order.update({ where: { id: orderId }, data: { status_msg_id: messageId } });

// «2026-10-08 21:30:00» (UTC) → дата по Москве «2026-10-09»
const moscowDayOf = (sqliteTimestamp) => new Date(fromSqliteTimestamp(sqliteTimestamp) + MOSCOW_OFFSET_MS).toISOString().slice(0, 10);

// Заказы за последние N дней (по московскому времени, включая сегодня) — для статистики; day — дата заказа по Москве
async function getOrdersSince(days) {
  const firstDay = new Date(Date.now() + MOSCOW_OFFSET_MS - (days - 1) * DAY_MS).toISOString().slice(0, 10);
  const periodStartUtc = toSqliteTimestamp(new Date(firstDay + 'T00:00:00Z').getTime() - MOSCOW_OFFSET_MS);
  const periodOrders = await database.order.findMany({ where: { created_at: { gte: periodStartUtc } }, orderBy: { id: 'asc' } });
  return periodOrders
    .map((order) => ({ ...parseOrder(order), day: moscowDayOf(order.created_at) }))
    .filter((order) => order.day >= firstDay);
}

// Календарь: сколько заказов уже на дату и интервал (отменённые не считаем)
const countSlotOrders = (deliveryDate, deliveryTime) => database.order.count({
  where: { delivery_date: deliveryDate, delivery_time: deliveryTime, status: { not: 'cancelled' } },
});

// Что везём в этот день: без отменённых и без ещё не оплаченных
async function getOrdersForDate(deliveryDate) {
  const dayOrders = await database.order.findMany({
    where: { delivery_date: deliveryDate, status: { not: 'cancelled' }, OR: [{ payment_status: null }, { payment_status: { not: 'pending' } }] },
    orderBy: [{ delivery_time: 'asc' }, { id: 'asc' }],
  });
  return dayOrders.map(parseOrder);
}

module.exports = {
  STATUSES, parseOrder, findOrder, getRecentOrders, getUserOrders, createOrder, restock, setOrderStatus, setStatusMessage,
  getOrdersSince, countSlotOrders, getOrdersForDate, moscowDayOf,
};
