// Проверка запросов витрины: адрес для расчёта доставки, дата для интервалов, номер заказа
const { ValidationError, createValidator, parsePositiveId, cleanText, isIsoDate } = require('../../validation');

const MAX_ADDRESS_LENGTH = 300;
const MIN_ADDRESS_LENGTH = 5;

// zone: 'region' — Ленобласть, всё остальное — Санкт-Петербург
const readZone = (zoneValue) => (zoneValue === 'region' ? 'region' : 'city');

const deliveryQuoteValidator = createValidator((request) => {
  const address = cleanText(request.body?.address, MAX_ADDRESS_LENGTH);
  if (address.length < MIN_ADDRESS_LENGTH) throw new ValidationError('Введите адрес');
  return { address, zone: readZone(request.body.zone), cartItems: request.body.items };
});

const slotsValidator = createValidator((request) => {
  const date = String(request.query.date || '');
  if (!isIsoDate(date)) throw new ValidationError('Неверная дата');
  return { date };
});

const orderIdValidator = createValidator((request) => ({ orderId: parsePositiveId(request.params.id) }));

module.exports = {
  deliveryQuoteValidator,
  slotsValidator,
  orderIdValidator,
  readZone,
  MAX_ADDRESS_LENGTH,
  MIN_ADDRESS_LENGTH,
};
