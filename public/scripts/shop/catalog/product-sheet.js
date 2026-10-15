// Карточка товара снизу (шторка): обычный букет, букет с размерами S/M/L и поштучные цветы с выбором количества.
// Закрывается крестиком, тапом по затемнению, свайпом вниз, Esc и кнопкой «Назад» Telegram.
import { state } from '../state.js';
import { getElement, escapeHtml } from '../../shared/dom.js';
import { formatRubles } from '../../shared/format.js';
import { vibrateSelection, vibrateNotification, showBackButton, hideBackButton } from '../../shared/telegram.js';
import { findProduct, isSoldByStem, hasSizes, findSize, cartKey, productPhotoHtml } from './product-helpers.js';
import { cartItems, cartTotal } from '../cart/cart-model.js';
import { changeCartQuantity } from '../cart/cart-actions.js';
import { openStemSheet, listenToStemQuantityInput } from './stem-sheet.js';

const SWIPE_CLOSE_DISTANCE = 90;
const sheetPhotoHtml = (product) =>
  `<div class="pic" style="background:${escapeHtml(product.bg)}">${productPhotoHtml(product, true)}</div>`;

export const isSheetOpen = () => getElement('sheetWrap').classList.contains('open');

/** keepState — перерисовка уже открытой шторки (не сбрасывать выбранный размер/количество) */
export function openProductSheet(productId, keepState) {
  const product = findProduct(productId);
  if (isSoldByStem(product)) return openStemSheet(product, keepState);
  if (hasSizes(product)) return openSizeSheet(product, keepState);
  const quantity = state.cart[productId] || 0;
  getElement('sheet').innerHTML = `${sheetPhotoHtml(product)}
    <div class="body"><h2>${escapeHtml(product.name)}</h2><p>${escapeHtml(product.description)}. Соберём в день заказа, приложим открытку бесплатно.</p>
    <button class="big" data-action="change-quantity" data-key="${product.id}" data-delta="1">${quantity ? `В корзине: ${quantity} · добавить ещё` : `В корзину · ${formatRubles(product.price)}`}</button></div>`;
  return showSheet();
}

// Букет с размерами S / M / L; по умолчанию — средний
function openSizeSheet(product, keepState) {
  if (!keepState || !findSize(product, state.selectedSize) || state.selectedSize === null)
    state.selectedSize = (product.sizes[1] || product.sizes[0]).name;
  const selectedSize = findSize(product, state.selectedSize);
  const sizesInCart = product.sizes
    .filter((size) => state.cart[cartKey(product.id, size.name)])
    .map((size) => `${size.name} × ${state.cart[cartKey(product.id, size.name)]}`);
  getElement('sheet').innerHTML = `${sheetPhotoHtml(product)}
    <div class="body"><h2>${escapeHtml(product.name)}</h2><p>${escapeHtml(product.description)}. Соберём в день заказа, приложим открытку бесплатно.</p>
    <div class="sizes">${product.sizes
      .map(
        (size) => `
      <button class="size ${size.name === state.selectedSize ? 'active' : ''}" data-action="select-size" data-product-id="${product.id}" data-size="${escapeHtml(size.name)}">
        <b>${escapeHtml(size.name)}</b><span>${escapeHtml(size.note || '')}</span><em>${formatRubles(size.price)}</em></button>`,
      )
      .join('')}</div>
    <div class="note">${sizesInCart.length ? 'В корзине: ' + sizesInCart.join(', ') : ''}</div>
    <button class="big" data-action="add-size-to-cart" data-key="${escapeHtml(cartKey(product.id, selectedSize.name))}">В корзину · ${escapeHtml(selectedSize.name)} · ${formatRubles(selectedSize.price)}</button></div>`;
  showSheet();
}

/** Показать шторку: крестик, «полоска» сверху и быстрый переход в корзину, если в ней что-то есть */
export function showSheet() {
  const sheet = getElement('sheet');
  sheet.insertAdjacentHTML(
    'afterbegin',
    '<div class="grab"></div><button class="x-close" data-action="close-sheet" aria-label="Закрыть">✕</button>',
  );
  if (cartItems().length) {
    sheet.querySelector('.body')?.insertAdjacentHTML(
      'beforeend',
      `<div class="sheet-foot">
      <button class="ghost-btn" data-action="close-sheet">← Каталог</button>
      <button class="tocart" data-action="go-to-page" data-page="cartPage">🛒 Корзина · ${formatRubles(cartTotal())}</button></div>`,
    );
  }
  if (!isSheetOpen()) sheet.scrollTop = 0;
  getElement('sheetWrap').classList.add('open');
  showBackButton();
}

export function closeSheet() {
  getElement('sheetWrap').classList.remove('open');
  if (!state.currentPage) hideBackButton();
}

// Свайп вниз по шторке — закрыть
export function listenToSheetSwipe() {
  const sheet = getElement('sheet');
  let touchStartY = null;
  sheet.addEventListener(
    'touchstart',
    (event) => {
      touchStartY = sheet.scrollTop <= 0 ? event.touches[0].clientY : null;
    },
    { passive: true },
  );
  sheet.addEventListener(
    'touchmove',
    (event) => {
      if (touchStartY == null) return;
      const distance = event.touches[0].clientY - touchStartY;
      if (distance > 0) sheet.style.transform = `translateY(${distance}px)`;
    },
    { passive: true },
  );
  sheet.addEventListener('touchend', (event) => {
    if (touchStartY == null) return;
    const distance = event.changedTouches[0].clientY - touchStartY;
    touchStartY = null;
    sheet.style.transform = '';
    if (distance > SWIPE_CLOSE_DISTANCE) closeSheet();
  });
  listenToStemQuantityInput(sheet);
}

export const productSheetActions = {
  'open-product': (element) => openProductSheet(Number(element.dataset.productId)),
  'close-sheet': () => closeSheet(),
  'select-size': (element) => {
    state.selectedSize = element.dataset.size;
    vibrateSelection();
    openSizeSheet(findProduct(element.dataset.productId), true);
  },
  'add-size-to-cart': (element) => {
    changeCartQuantity(element.dataset.key, 1);
    vibrateNotification('success');
  },
};
