// Цены заказа. Берём их ТОЛЬКО из базы — покупатель не может подменить их в браузере.
const { findProduct } = require('../catalog');

// Сколько одинаковых букетов/допов можно в одном заказе (поштучные цветы — до 501).
// Больше — это уже оптовый заказ: пусть покупатель напишет флористу.
const MAX_PER_ITEM = 10;
const MAX_SINGLE_FLOWERS = 501;

const userError = (message) => Object.assign(new Error(message), { expose: true });

// Корзина из витрины [{id, qty, size}] → позиции заказа [{id, name, price, qty, unit, size}].
// Бросает ошибку с понятным покупателю текстом (expose = true).
async function priceItems(cartItems) {
  const orderItems = [];
  for (const cartItem of Array.isArray(cartItems) ? cartItems : []) {
    const product = await findProduct(Number(cartItem?.id));
    const quantity = Math.floor(Number(cartItem?.qty));
    if (!product || !product.in_stock) throw userError('Некоторых букетов уже нет в наличии, обновите витрину');
    // Поштучно — не меньше минимума (например, от 5 роз) и не больше 501; букеты и допы — до 10
    const minimumQuantity = product.min_qty || 1;
    const maximumQuantity = product.unit ? MAX_SINGLE_FLOWERS : MAX_PER_ITEM;
    if (!(quantity >= minimumQuantity && quantity <= maximumQuantity)) {
      throw userError(`«${product.name}»: можно заказать от ${minimumQuantity} до ${maximumQuantity} шт`);
    }
    // Размер S/M/L — своя цена
    let price = product.price;
    let name = product.name;
    let size = null;
    if (product.sizes?.length) {
      const chosenSize = product.sizes.find((productSize) => productSize.name === cartItem.size) || product.sizes[0];
      price = chosenSize.price;
      size = chosenSize.name;
      name = `${product.name} (${chosenSize.name})`;
    }
    orderItems.push({ id: product.id, name, price, qty: quantity, unit: product.unit || null, size });
  }
  // Хватает ли остатка (с учётом того, что один букет может быть в корзине в разных размерах)
  const quantityByProduct = new Map();
  for (const orderItem of orderItems) quantityByProduct.set(orderItem.id, (quantityByProduct.get(orderItem.id) || 0) + orderItem.qty);
  for (const [productId, totalQuantity] of quantityByProduct) {
    const product = await findProduct(productId);
    if (!product.unit && totalQuantity > MAX_PER_ITEM) {
      throw userError(`«${product.name}»: в одном заказе до ${MAX_PER_ITEM} шт. Для большего заказа напишите флористу 💐`);
    }
    if (product.stock != null && product.stock < totalQuantity) throw userError(`«${product.name}»: осталось только ${product.stock} шт`);
  }
  if (!orderItems.length) throw userError('Корзина пуста');
  return orderItems;
}

const itemsTotal = (orderItems) => orderItems.reduce((sum, orderItem) => sum + orderItem.price * orderItem.qty, 0);

module.exports = { priceItems, itemsTotal, MAX_PER_ITEM, MAX_SINGLE_FLOWERS };
