// Проверка формы оформления заказа: имя, телефон, адрес, дата и интервал доставки (по Москве), корзина
const { ValidationError, createValidator, cleanText } = require('../../validation');
const { priceItems, itemsTotal } = require('../../../pricing');
const { checkDeliverySlot } = require('../../../calendar');
const { readZone } = require('../shop/validation');

const MIN_PHONE_DIGITS = 10;
const MIN_ADDRESS_LENGTH = 5;

// Порядок проверок как раньше: сначала корзина, потом поля формы, потом календарь
const orderFormValidator = createValidator(async (request) => {
  const form = request.body || {};
  const orderItems = await priceItems(form.items); // ошибки корзины — с понятным текстом (expose)
  const orderForm = {
    customer_name: cleanText(form.customer_name, 100),
    phone: cleanText(form.phone, 30),
    address: cleanText(form.address, 300),
    delivery_date: cleanText(form.delivery_date, 10),
    delivery_time: cleanText(form.delivery_time, 20),
    recipient: cleanText(form.recipient, 100) || null,
    card_text: cleanText(form.card_text, 300) || null,
    comment: cleanText(form.comment, 300) || null,
  };
  if (!orderForm.customer_name) throw new ValidationError('Укажите имя');
  if (orderForm.phone.replace(/\D/g, '').length < MIN_PHONE_DIGITS)
    throw new ValidationError('Проверьте номер телефона');
  if (orderForm.address.length < MIN_ADDRESS_LENGTH) throw new ValidationError('Укажите адрес доставки');
  const slotError = await checkDeliverySlot(orderForm.delivery_date, orderForm.delivery_time);
  if (slotError) throw new ValidationError(slotError);
  return { orderForm, orderItems, goodsTotal: itemsTotal(orderItems), zone: readZone(form.delivery_zone) };
});

module.exports = { orderFormValidator };
