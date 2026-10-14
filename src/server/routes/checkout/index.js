// Оформление заказа в витрине. Всё считаем на сервере: цены — из базы, доставку — по адресу, остатки — в транзакции.
const express = require('express');
const delivery = require('../../../delivery');
const { createOrder, findOrder } = require('../../../orders');
const payments = require('../../../payments');
const { notifyNewOrder, notifyLowStock } = require('../../../notifications');
const { asyncHandler } = require('../../async-handler');
const { createRateLimit } = require('../../auth');
const { orderFormValidator } = require('./validation');

const ORDERS_PER_WINDOW = 5;
const ORDER_WINDOW_MS = 10 * 60000;

function createCheckoutRouter({ bot, telegramAuth }) {
  const router = express.Router();
  // Не больше 5 заказов за 10 минут с одного Telegram-аккаунта
  const orderLimit = createRateLimit({
    max: ORDERS_PER_WINDOW, windowMs: ORDER_WINDOW_MS, key: (request) => request.telegramUser.id,
    message: 'Слишком много заказов подряд 🌷 Попробуйте через 10 минут или напишите нам',
  });

  router.post('/orders', telegramAuth, orderLimit, orderFormValidator, asyncHandler(async (request, response) => {
    const { orderForm, orderItems, goodsTotal, zone } = request.validated;
    const orderData = {
      ...orderForm,
      user_id: request.telegramUser.id,
      username: request.telegramUser.username || null,
      items: orderItems,
      total: goodsTotal,
      delivery_fee: null, delivery_km: null, delivery_zone: null,
    };

    // Доставку пересчитываем на сервере — сумме из браузера не доверяем.
    // Если геокодер временно не отвечает, заказ всё равно примем, а стоимость доставки уточним вручную.
    try {
      const deliveryQuote = await delivery.quote(orderData.address, zone, goodsTotal);
      if (!deliveryQuote.ok) return response.status(400).json({ error: deliveryQuote.error });
      Object.assign(orderData, { delivery_fee: deliveryQuote.fee, delivery_km: deliveryQuote.km, delivery_zone: deliveryQuote.zone, total: goodsTotal + deliveryQuote.fee });
    } catch (geocoderError) {
      console.error('Геокодер недоступен, доставку уточним вручную:', geocoderError.message);
    }

    let createdOrder;
    try {
      createdOrder = await createOrder(orderData);
    } catch (orderError) {
      if (orderError.expose) return response.status(400).json({ error: orderError.message }); // кто-то успел купить последний букет
      throw orderError;
    }
    const orderId = createdOrder.id;
    const savedOrder = await findOrder(orderId);
    await notifyLowStock(bot, createdOrder.stockLeft);

    // Онлайн-оплата включена — сначала оплата, а флористу сообщим, когда деньги придут
    if (payments.isEnabled() && savedOrder.delivery_fee != null) {
      try {
        const paymentUrl = await payments.startPayment(bot, savedOrder);
        return response.json({ ok: true, id: orderId, pay_url: paymentUrl, total: savedOrder.total });
      } catch (paymentError) {
        console.error('Не удалось создать платёж:', paymentError.message); // заказ не теряем — флорист договорится об оплате сам
      }
    }
    await notifyNewOrder(bot, savedOrder);
    return response.json({ ok: true, id: orderId });
  }));

  return router;
}

module.exports = { createCheckoutRouter };
