// Витрина: каталог, доставка (тарифы и расчёт по адресу), свободные интервалы, «Мои заказы» и «Повторить заказ»
const express = require('express');
const { getShowcaseProducts } = require('../../../catalog');
const { findOrder, getUserOrders } = require('../../../orders');
const { shortWhen, statusLabel } = require('../../../orders/texts');
const { priceItems, itemsTotal } = require('../../../pricing');
const delivery = require('../../../delivery');
const payments = require('../../../payments/yookassa');
const { slotsFor } = require('../../../calendar');
const { asyncHandler } = require('../../async-handler');
const { createRateLimit } = require('../../auth');
const { deliveryQuoteValidator, slotsValidator, orderIdValidator } = require('./validation');

const MY_ORDERS_LIMIT = 30;
const QUOTES_PER_WINDOW = 30;
const QUOTE_WINDOW_MS = 10 * 60000;

// «Мои заказы» в витрине: только то, что нужно карточке заказа
const myOrderCard = (order) => ({
  id: order.id,
  status: order.status,
  status_label: statusLabel(order.status),
  items: order.items.map(({ id, name, qty, unit, price }) => ({ id, name, qty, unit, price })),
  total: order.total,
  delivery_fee: order.delivery_fee,
  when: shortWhen(order),
  address: order.address,
  card_text: order.card_text,
  recipient: order.recipient,
  rating: order.rating,
  payment_status: order.payment_status,
  pay_url: order.payment_status === 'pending' ? order.pay_url : null,
  photo_status: order.photo_status,
});

function createShopRouter({ telegramAuth }) {
  const router = express.Router();
  // Расчёт доставки, пока покупатель вводит адрес: не больше 30 проверок за 10 минут
  const quoteLimit = createRateLimit({
    max: QUOTES_PER_WINDOW,
    windowMs: QUOTE_WINDOW_MS,
    key: (request) => request.telegramUser.id,
    message: 'Слишком много проверок адреса, подождите пару минут',
  });

  router.get(
    '/products',
    asyncHandler(async (request, response) => response.json(await getShowcaseProducts())),
  );

  router.get(
    '/delivery-info',
    asyncHandler(async (request, response) => {
      const tariff = await delivery.getTariff();
      response.json({
        shop: delivery.SHOP.name,
        city: tariff.city,
        region: tariff.region,
        freeFrom: tariff.freeFrom,
        payOnline: payments.isEnabled(),
      });
    }),
  );

  router.post(
    '/delivery-quote',
    telegramAuth,
    quoteLimit,
    deliveryQuoteValidator,
    asyncHandler(async (request, response) => {
      const { address, zone, cartItems } = request.validated;
      let goodsTotal = 0;
      try {
        goodsTotal = itemsTotal(await priceItems(cartItems)); // для «бесплатно от суммы»; корзина с ошибкой — считаем без неё
      } catch {
        goodsTotal = 0;
      }
      try {
        const deliveryQuote = await delivery.quote(address, zone, goodsTotal);
        return response
          .status(deliveryQuote.ok ? 200 : 400)
          .json(deliveryQuote.ok ? deliveryQuote : { error: deliveryQuote.error });
      } catch (geocoderError) {
        console.error('Геокодер:', geocoderError.message);
        return response.json({
          ok: true,
          fee: null,
          error: 'Не получилось рассчитать доставку — уточним после заказа',
        });
      }
    }),
  );

  // Свободные интервалы на дату (витрина показывает занятые серым)
  router.get(
    '/slots',
    slotsValidator,
    asyncHandler(async (request, response) => response.json(await slotsFor(request.validated.date))),
  );

  // «Мои заказы» в витрине: все заказы покупателя (только его собственные)
  router.get(
    '/my-orders',
    telegramAuth,
    asyncHandler(async (request, response) => {
      response.json((await getUserOrders(request.telegramUser.id, MY_ORDERS_LIMIT)).map(myOrderCard));
    }),
  );

  // Для кнопки «Повторить заказ»: отдаём покупателю ЕГО заказ, чтобы собрать корзину заново
  router.get(
    '/my-orders/:id',
    telegramAuth,
    orderIdValidator,
    asyncHandler(async (request, response) => {
      const order = await findOrder(request.validated.orderId);
      if (!order || String(order.user_id) !== String(request.telegramUser.id))
        return response.status(404).json({ error: 'Заказ не найден' });
      return response.json({
        id: order.id,
        items: order.items.map(({ id, qty, size }) => ({ id, qty, size })),
        address: order.address,
        zone: order.delivery_zone === 'Ленобласть' ? 'region' : 'city',
        recipient: order.recipient,
      });
    }),
  );

  return router;
}

module.exports = { createShopRouter };
