// Изменение корзины: −/+ на карточках, в корзине и в шторке; проверка остатков и лимита одного заказа.
import { state } from '../state.js';
import { getElement } from '../../shared/dom.js';
import { showAlert, vibrateSelection } from '../../shared/telegram.js';
import { findProduct, parseCartKey, minQuantity, maxQuantity, isSoldByStem } from '../catalog/product-helpers.js';
import { renderGrid } from '../catalog/catalog-view.js';
import { openProductSheet, isSheetOpen } from '../catalog/product-sheet.js';
import { quantityInCart } from './cart-model.js';
import { renderCartBar, renderCartPage } from './cart-view.js';
import { playAddToCartEffect } from './add-effect.js';

/** Перерисовать всё, что показывает корзину */
export function refreshCartViews() {
  renderGrid();
  renderCartBar();
}

/** delta: +1 / −1 (0 — просто перерисовать после ручного изменения state.cart) */
export function changeCartQuantity(key, delta) {
  const { productId } = parseCartKey(key);
  const product = findProduct(productId);
  const currentQuantity = state.cart[key] || 0;
  let nextQuantity = currentQuantity + delta;
  if (delta > 0 && currentQuantity === 0) nextQuantity = minQuantity(product); // первое добавление — сразу минимум
  if (nextQuantity < minQuantity(product)) nextQuantity = 0; // меньше минимума — убираем из корзины
  // Не больше, чем есть на складе (с учётом других размеров этого же букета)
  const quantityAfterChange = quantityInCart(productId) - currentQuantity + nextQuantity;
  if (product.stock != null && delta > 0 && quantityAfterChange > product.stock) {
    showAlert(`Больше нет в наличии — осталось ${product.stock} шт`);
    return;
  }
  if (delta > 0 && quantityAfterChange > maxQuantity(product)) {
    showAlert(
      `В одном заказе — до ${maxQuantity(product)} шт «${product.name}». Нужно больше? Напишите флористу в чат с ботом — соберём оптовый заказ 💐`,
    );
    return;
  }
  if (nextQuantity > currentQuantity) playAddToCartEffect(); // до перерисовки, пока карточка на месте
  state.cart[key] = nextQuantity;
  if (!state.cart[key]) delete state.cart[key];
  vibrateSelection();
  refreshCartViews();
  if (isSheetOpen() && !isSoldByStem(product)) openProductSheet(productId, true);
  if (getElement('cartPage').classList.contains('show')) renderCartPage();
}

export const cartActions = {
  'change-quantity': (element) => changeCartQuantity(element.dataset.key, Number(element.dataset.delta)),
};
