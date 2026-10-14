// Корзина как данные: строки с ценами, суммы, сохранение между запусками витрины.
import { state } from '../state.js';
import { telegramUser } from '../../shared/telegram.js';
import { findProduct, findSize, parseCartKey, isSoldByStem } from '../catalog/product-helpers.js';

/** Сколько штук товара в корзине (все размеры вместе) */
export const quantityInCart = (productId) => Object.entries(state.cart)
  .filter(([key]) => parseCartKey(key).productId === productId)
  .reduce((sum, [, quantity]) => sum + quantity, 0);

/** Строки корзины: товар + key, qty, выбранный размер, цена и название с размером. Букеты сверху, допы — в конце */
export const cartItems = () => Object.entries(state.cart).map(([key, quantity]) => {
  const { productId, sizeName } = parseCartKey(key);
  const product = findProduct(productId);
  if (!product) return null;
  const size = findSize(product, sizeName);
  return {
    ...product, key, qty: quantity, size: size?.name || null,
    price: size ? size.price : product.price, title: size ? `${product.name} · ${size.name}` : product.name,
  };
}).filter(Boolean).sort((first, second) => first.addon - second.addon);

export const cartTotal = () => cartItems().reduce((sum, item) => sum + item.price * item.qty, 0);

/** Число на значке корзины: букеты — штуками, поштучные цветы — одной позицией */
export const cartBadgeCount = () => cartItems().reduce((sum, item) => sum + (isSoldByStem(item) ? 1 : item.qty), 0);

/** Строки для запроса на сервер */
export const cartItemsForServer = () => cartItems().map((item) => ({ id: item.id, qty: item.qty, size: item.size }));

// Корзина сохраняется: закрыла витрину — открыла — всё на месте
const cartStorageKey = () => 'fler_cart_' + (telegramUser()?.id || 'guest');

export function saveCart() {
  try {
    localStorage.setItem(cartStorageKey(), JSON.stringify(state.cart));
  } catch { /* браузер запретил хранилище — корзина просто не запомнится */ }
}

export function restoreCart() {
  try {
    const savedCart = JSON.parse(localStorage.getItem(cartStorageKey()) || '{}');
    for (const [key, quantity] of Object.entries(savedCart)) {
      if (findProduct(parseCartKey(key).productId) && quantity > 0) state.cart[key] = quantity;
    }
  } catch { /* испорченная запись — начинаем с пустой корзины */ }
}

// Имя, телефон и адрес из прошлого заказа подставляются в форму (если браузер разрешает хранилище)
export const savedField = {
  get(name) { try { return localStorage.getItem(name) || ''; } catch { return ''; } },
  set(name, value) { try { localStorage.setItem(name, value); } catch { /* не запомним — не страшно */ } },
};
