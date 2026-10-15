// Шторка поштучного цветка: готовые варианты количества (3, 5, 7…), −/+ и своё число.
import { state } from '../state.js';
import { getElement, escapeHtml } from '../../shared/dom.js';
import { formatRubles } from '../../shared/format.js';
import { showAlert, vibrateSelection, vibrateNotification } from '../../shared/telegram.js';
import { findProduct, minQuantity, productPhotoHtml } from './product-helpers.js';
import { playAddToCartEffect } from '../cart/add-effect.js';
import { refreshCartViews, changeCartQuantity } from '../cart/cart-actions.js';
import { showSheet, closeSheet } from './product-sheet.js';

const QUANTITY_PRESETS = [3, 5, 7, 9, 11, 15, 25, 51, 101];
const DEFAULT_STEMS = 11;
const MAX_STEMS = 501;
const LUXURY_STEMS = 51;
const SHOW_STOCK_BELOW = 50;

export function openStemSheet(product, keepQuantity) {
  const minimum = minQuantity(product);
  if (!keepQuantity)
    state.stemQuantity =
      state.cart[product.id] || Math.max(minimum, DEFAULT_STEMS >= minimum ? DEFAULT_STEMS : minimum);
  const presets = QUANTITY_PRESETS.filter(
    (count) => count >= minimum && (product.stock == null || count <= product.stock),
  );
  if (product.stock != null && state.stemQuantity > product.stock) state.stemQuantity = product.stock;
  const quantity = state.stemQuantity;
  const quantityInCart = state.cart[product.id] || 0;
  let hint = '';
  if (quantity % 2 === 0) hint = '💡 В подарок обычно дарят нечётное количество';
  else if (quantity >= LUXURY_STEMS) hint = '✨ Роскошный букет!';
  const stockNote =
    product.stock != null && product.stock <= SHOW_STOCK_BELOW ? ` · в наличии ${product.stock} шт` : '';
  getElement('sheet').innerHTML =
    `<div class="pic" style="background:${escapeHtml(product.bg)}">${productPhotoHtml(product, true)}</div>
    <div class="body"><h2>${escapeHtml(product.name)}</h2>
    <p>${escapeHtml(product.description)}. ${formatRubles(product.price)} за штуку${minimum > 1 ? `, от ${minimum} шт` : ''}${stockNote}. Упакуем бесплатно.</p>
    <div class="presets">${presets.map((count) => `<button class="preset ${count === quantity ? 'active' : ''}" data-action="set-stem-quantity" data-product-id="${product.id}" data-quantity="${count}">${count}</button>`).join('')}</div>
    <div class="stepper">
      <button data-action="step-stem-quantity" data-product-id="${product.id}" data-delta="-1" aria-label="Меньше">−</button>
      <input type="number" inputmode="numeric" value="${quantity}" min="${minimum}" max="${MAX_STEMS}" data-product-id="${product.id}" aria-label="Количество">
      <button data-action="step-stem-quantity" data-product-id="${product.id}" data-delta="1" aria-label="Больше">+</button>
    </div>
    <div class="note">${hint}</div>
    <button class="big" data-action="put-stems" data-product-id="${product.id}">${quantityInCart ? 'Обновить' : 'В корзину'} · ${quantity} шт · ${formatRubles(quantity * product.price)}</button>
    ${quantityInCart ? `<button class="remove" data-action="remove-stems" data-product-id="${product.id}">Убрать из корзины</button>` : ''}
    </div>`;
  showSheet();
}

/** Количество в пределах минимума, остатка на складе и 501 шт */
function setStemQuantity(productId, requestedQuantity) {
  const product = findProduct(productId);
  const maximum = product.stock != null ? Math.min(MAX_STEMS, product.stock) : MAX_STEMS;
  state.stemQuantity = Math.min(
    maximum,
    Math.max(minQuantity(product), Math.floor(requestedQuantity) || minQuantity(product)),
  );
  if (requestedQuantity > maximum) showAlert(`В наличии только ${maximum} шт`);
  vibrateSelection();
  openStemSheet(product, true);
}

function putStemsInCart(productId) {
  const key = String(productId);
  if (state.stemQuantity > (state.cart[key] || 0)) playAddToCartEffect();
  state.cart[key] = state.stemQuantity;
  vibrateNotification('success');
  refreshCartViews();
  closeSheet();
}

/** Своё число в поле количества (событие change — после ввода) */
export function listenToStemQuantityInput(sheet) {
  sheet.addEventListener('change', (event) => {
    if (event.target.matches('.stepper input'))
      setStemQuantity(Number(event.target.dataset.productId), Number(event.target.value));
  });
}

export const stemSheetActions = {
  'set-stem-quantity': (element) =>
    setStemQuantity(Number(element.dataset.productId), Number(element.dataset.quantity)),
  'step-stem-quantity': (element) =>
    setStemQuantity(Number(element.dataset.productId), state.stemQuantity + Number(element.dataset.delta)),
  'put-stems': (element) => putStemsInCart(Number(element.dataset.productId)),
  'remove-stems': (element) => {
    const key = String(element.dataset.productId);
    state.cart[key] = 0;
    changeCartQuantity(key, 0); // уберёт строку и перерисует корзину
    closeSheet();
  },
};
