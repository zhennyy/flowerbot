// Админка, вкладка «Статистика»: выручка по дням, средний чек, топ букетов, повторные покупатели, оценки
const express = require('express');
const { STATUSES, getOrdersSince } = require('../../../orders');
const { moscowDate } = require('../../../calendar');
const { asyncHandler } = require('../../async-handler');
const { statsValidator } = require('./validation');

const TOP_LIST_SIZE = 7;

const goodsSum = (order) => order.items.reduce((sum, orderItem) => sum + orderItem.price * orderItem.qty, 0);

async function buildStats(days) {
  const periodOrders = await getOrdersSince(days);
  // Отменённые и ещё не оплаченные в выручку не считаем
  const countedOrders = periodOrders.filter(
    (order) =>
      order.status !== 'cancelled' && order.payment_status !== 'pending' && order.payment_status !== 'canceled',
  );

  // По дням: заполняем все дни периода, даже пустые — чтобы график был честным
  const byDay = [];
  for (let daysAgo = days - 1; daysAgo >= 0; daysAgo--) {
    const date = moscowDate(-daysAgo);
    const dayOrders = countedOrders.filter((order) => order.day === date);
    byDay.push({ date, revenue: dayOrders.reduce((sum, order) => sum + order.total, 0), orders: dayOrders.length });
  }

  // Топ товаров по выручке
  const topProducts = new Map();
  for (const order of countedOrders) {
    for (const orderItem of order.items) {
      const productTotals = topProducts.get(orderItem.id) || {
        name: orderItem.name,
        qty: 0,
        revenue: 0,
        unit: orderItem.unit,
      };
      productTotals.qty += orderItem.qty;
      productTotals.revenue += orderItem.price * orderItem.qty;
      topProducts.set(orderItem.id, productTotals);
    }
  }

  // Покупатели: сколько вернулись повторно
  const ordersPerCustomer = new Map();
  for (const order of countedOrders)
    ordersPerCustomer.set(order.user_id, (ordersPerCustomer.get(order.user_id) || 0) + 1);

  const revenue = countedOrders.reduce((sum, order) => sum + order.total, 0);
  const byStatus = {};
  for (const order of periodOrders) byStatus[order.status] = (byStatus[order.status] || 0) + 1;
  const ratedOrders = countedOrders.filter((order) => order.rating);

  return {
    days,
    revenue,
    goods: countedOrders.reduce((sum, order) => sum + goodsSum(order), 0),
    delivery: countedOrders.reduce((sum, order) => sum + (order.delivery_fee || 0), 0),
    orders: countedOrders.length,
    cancelled: byStatus.cancelled || 0,
    avg: countedOrders.length ? Math.round(revenue / countedOrders.length) : 0,
    customers: ordersPerCustomer.size,
    repeat: [...ordersPerCustomer.values()].filter((orderCount) => orderCount > 1).length,
    cards: countedOrders.filter((order) => order.card_text).length,
    rated: ratedOrders.length,
    rating: ratedOrders.length
      ? Math.round((ratedOrders.reduce((sum, order) => sum + order.rating, 0) / ratedOrders.length) * 10) / 10
      : null,
    byDay,
    top: [...topProducts.values()].sort((first, second) => second.revenue - first.revenue).slice(0, TOP_LIST_SIZE),
    byStatus,
    statuses: STATUSES,
  };
}

function createAdminStatsRouter({ ownerAuth }) {
  const router = express.Router();
  router.get(
    '/stats',
    ownerAuth,
    statsValidator,
    asyncHandler(async (request, response) => response.json(await buildStats(request.validated.days))),
  );
  return router;
}

module.exports = { createAdminStatsRouter, buildStats };
