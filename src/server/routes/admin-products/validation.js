// Проверка формы букета из админки и загрузки фото с телефона
const { ValidationError, createValidator, parsePositiveId, cleanText } = require('../../validation');
const { decodeJpeg } = require('../../photos');

const MAX_SIZES = 5;
const MAX_MIN_QTY = 101;
const DEFAULT_BG = '#f6e3ea';

// Приводим данные товара из формы к правильному виду
function cleanProduct(form = {}) {
  const product = {
    category: cleanText(form.category, 40),
    name: cleanText(form.name, 80),
    description: cleanText(form.description, 200),
    price: Math.round(Number(form.price)),
    photo_url: cleanText(form.photo_url, 500) || null,
    badge: cleanText(form.badge, 20) || null,
    bg: /^#[0-9a-f]{6}$/i.test(form.bg) ? form.bg : DEFAULT_BG,
    in_stock: form.in_stock === false || form.in_stock === 0 ? 0 : 1,
    unit: form.unit ? 'шт' : null, // галочка «продаётся поштучно»
    min_qty: Math.min(MAX_MIN_QTY, Math.max(1, Math.floor(Number(form.min_qty)) || 1)),
    // Остаток: пусто — не считаем; число — списывается с каждым заказом
    stock: form.stock === '' || form.stock == null ? null : Math.max(0, Math.floor(Number(form.stock)) || 0),
    addon: form.addon ? 1 : 0, // показывать в корзине «Добавить к заказу»
    emoji: cleanText(form.emoji, 8) || null,
    sizes: null,
  };
  // Размеры S/M/L: [{name, price, note}]
  const sizes = (Array.isArray(form.sizes) ? form.sizes : [])
    .map((size) => ({
      name: cleanText(size?.name, 12),
      price: Math.round(Number(size?.price)),
      note: cleanText(size?.note, 40),
    }))
    .filter((size) => size.name && size.price > 0)
    .slice(0, MAX_SIZES);
  if (sizes.length) {
    product.sizes = JSON.stringify(sizes);
    product.price = Math.min(...sizes.map((size) => size.price)); // в каталоге — «от N ₽»
  }
  if (!product.category || !product.name) throw new ValidationError('Заполните название и категорию');
  if (!(product.price > 0)) throw new ValidationError('Цена должна быть больше нуля');
  if (product.photo_url && !/^(https:\/\/|\/uploads\/|\/photos\/)/.test(product.photo_url))
    throw new ValidationError('Ссылка на фото должна начинаться с https://');
  return product;
}

const productFormValidator = createValidator((request) => ({ productData: cleanProduct(request.body) }));
const productIdValidator = createValidator((request) => ({ productId: parsePositiveId(request.params.id) }));
// Админка присылает два JPEG — большой и маленький
const photoUploadValidator = createValidator((request) => ({
  fullPhoto: decodeJpeg(request.body?.full),
  thumbnailPhoto: decodeJpeg(request.body?.thumb),
}));

module.exports = { cleanProduct, productFormValidator, productIdValidator, photoUploadValidator };
