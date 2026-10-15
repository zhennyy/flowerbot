// Админка: список заказов, смена статуса (покупатель получает сообщение), фото готового букета на согласование
const express = require('express');
const { STATUSES, getRecentOrders } = require('../../../orders');
const { changeStatus } = require('../../../orders/status');
const { sendBouquetPhoto } = require('../../../bouquet-photo');
const { asyncHandler } = require('../../async-handler');
const { statusChangeValidator, bouquetPhotoValidator } = require('./validation');

const ADMIN_ORDERS_LIMIT = 100;

function createAdminOrdersRouter({ bot, ownerAuth }) {
  const router = express.Router();

  router.get(
    '/orders',
    ownerAuth,
    asyncHandler(async (request, response) => {
      response.json({ orders: await getRecentOrders(ADMIN_ORDERS_LIMIT), statuses: STATUSES });
    }),
  );

  router.post(
    '/orders/:id/status',
    ownerAuth,
    statusChangeValidator,
    asyncHandler(async (request, response) => {
      response.json(await changeStatus(bot, request.validated.orderId, request.validated.status));
    }),
  );

  // Фото готового букета из админки → покупателю на согласование
  router.post(
    '/orders/:id/photo',
    ownerAuth,
    bouquetPhotoValidator,
    asyncHandler(async (request, response) => {
      const { orderId, bouquetPhoto } = request.validated;
      try {
        return response.json(await sendBouquetPhoto(bot, orderId, { source: bouquetPhoto, filename: 'bouquet.jpg' }));
      } catch (sendError) {
        return response.status(400).json({ error: sendError.message }); // например, покупатель заблокировал бота
      }
    }),
  );

  return router;
}

module.exports = { createAdminOrdersRouter };
