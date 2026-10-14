// Админка, «Статистика»: выручка без отменённых и неоплаченных, дни по Москве, топ букетов, повторные покупатели
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const testHelpers = require('../../test-helpers');

const OWNER_ID = testHelpers.OWNER_ID;
let shop;

before(async () => { shop = await testHelpers.start(); });

test('выручка считает оплаченные и без онлайн-оплаты, не считает отменённые и ждущие оплаты', async () => {
  const { toSqliteTimestamp } = require('../../../database');
  const baseOrder = { customer_name: 'А', phone: '89000000000', address: 'Невский', delivery_date: '2026-10-20', delivery_time: '12:00–15:00' };
  const items = (productId, price, qty) => JSON.stringify([{ id: productId, name: `Букет ${productId}`, price, qty, unit: null, size: null }]);
  await shop.database.order.createMany({ data: [
    { ...baseOrder, user_id: 1, items: items(1, 3000, 1), total: 3290, delivery_fee: 290, payment_status: 'paid', rating: 5, card_text: 'Люблю' },
    { ...baseOrder, user_id: 1, items: items(2, 8000, 1), total: 8000, delivery_fee: 0, rating: 4 },
    { ...baseOrder, user_id: 2, items: items(1, 3000, 2), total: 6390, delivery_fee: 390, payment_status: null },
    { ...baseOrder, user_id: 3, items: items(3, 9999, 1), total: 9999, status: 'cancelled' },
    { ...baseOrder, user_id: 4, items: items(3, 5000, 1), total: 5000, payment_status: 'pending' },
    // 40 дней назад — в 30-дневную статистику не попадает
    { ...baseOrder, user_id: 5, items: items(3, 1000, 1), total: 1000, created_at: toSqliteTimestamp(Date.now() - 40 * 864e5) },
  ] });

  const response = await shop.call(OWNER_ID, 'GET', '/api/admin/stats?days=30');
  const stats = response.body;
  assert.equal(stats.days, 30);
  assert.equal(stats.orders, 3);
  assert.equal(stats.revenue, 3290 + 8000 + 6390);
  assert.equal(stats.delivery, 680);
  assert.equal(stats.goods, 3000 + 8000 + 6000);
  assert.equal(stats.avg, Math.round(17680 / 3));
  assert.equal(stats.cancelled, 1);
  assert.equal(stats.customers, 2);
  assert.equal(stats.repeat, 1);
  assert.equal(stats.cards, 1);
  assert.equal(stats.rated, 2);
  assert.equal(stats.rating, 4.5);
  assert.deepEqual(stats.top[0], { name: 'Букет 1', qty: 3, revenue: 9000, unit: null });
  assert.equal(stats.byDay.length, 30);
  assert.equal(stats.byDay.at(-1).date, new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10), 'последний день — сегодня по Москве');
  assert.deepEqual(stats.byDay.at(-1), { date: stats.byDay.at(-1).date, revenue: 17680, orders: 3 });
  assert.deepEqual(stats.byStatus, { new: 4, cancelled: 1 });
  assert.equal(stats.statuses.done, '🌷 Доставлен');

  assert.equal((await shop.call(OWNER_ID, 'GET', '/api/admin/stats?days=90')).body.orders, 4);
  assert.equal((await shop.call(OWNER_ID, 'GET', '/api/admin/stats?days=1000')).body.days, 30);
  assert.equal((await shop.call(7801, 'GET', '/api/admin/stats')).status, 403);
});
