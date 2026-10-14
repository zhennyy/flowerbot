// Вебхук ЮKassa (без авторизации — его вызывает сама ЮKassa).
// Адрес общий для всех магазинов BotForAll: сервер рассылает уведомление всем ботам, каждый проверяет платёж в ЮKassa
// и берёт только свой (metadata.app = flowerbot и номер своего заказа).
const express = require('express');
const payments = require('../../../payments');
const { paymentNotificationValidator } = require('./validation');

function createYookassaRouter({ bot }) {
  const router = express.Router();

  router.post('/yookassa-webhook', paymentNotificationValidator, (request, response) => {
    response.sendStatus(200); // ЮKassa ждёт быстрый ответ; платёж проверяем уже после
    if (!payments.isEnabled()) return;
    payments.syncPayment(bot, request.validated.paymentId).catch((syncError) => console.error('ЮKassa webhook:', syncError.message));
  });

  return router;
}

module.exports = { createYookassaRouter };
