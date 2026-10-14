// Проверка уведомления ЮKassa: нужен только корректный id платежа — всё остальное узнаём у самой ЮKassa.
// Без id или с кривым id уведомление просто подтверждаем (200), чтобы ЮKassa не слала его повторно.
const PAYMENT_ID_PATTERN = /^[\w-]{1,64}$/;

function paymentNotificationValidator(request, response, next) {
  const paymentId = String(request.body?.object?.id || '');
  if (!PAYMENT_ID_PATTERN.test(paymentId)) return response.sendStatus(200);
  request.validated = { paymentId };
  return next();
}

module.exports = { paymentNotificationValidator, PAYMENT_ID_PATTERN };
