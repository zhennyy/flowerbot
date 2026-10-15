// Переход между экранами поверх каталога (корзина, оформление, «Мои заказы», «Спасибо»)
// и «Назад»: системная кнопка Telegram, Esc на ноутбуке, стрелки «←» в шапках экранов.
import { state } from './state.js';
import { getElement } from '../shared/dom.js';
import { telegram, onBackButton } from '../shared/telegram.js';
import { closeSheet, isSheetOpen } from './catalog/product-sheet.js';
import { renderCartPage } from './cart/cart-view.js';
import { prepareCheckout } from './checkout/checkout-form.js';
import { checkoutState } from './checkout/checkout-state.js';
import { loadMyOrders } from './orders/my-orders.js';

const PAGES = ['cartPage', 'checkoutPage', 'donePage', 'ordersPage'];

/** page — id экрана или null (каталог) */
export function goToPage(page) {
  closeSheet();
  PAGES.forEach((pageId) => getElement(pageId).classList.toggle('show', pageId === page));
  if (page === 'ordersPage') loadMyOrders(true);
  state.currentPage = page;
  if (page === 'cartPage') renderCartPage();
  if (page === 'checkoutPage') {
    // корзина могла измениться — пересчитаем доставку
    checkoutState.quote = null;
    prepareCheckout();
  }
  if (telegram?.BackButton) {
    if (page && page !== 'donePage') telegram.BackButton.show();
    else telegram.BackButton.hide();
  }
  window.scrollTo(0, 0);
}

// Из оформления «назад» — в корзину, с остальных экранов — в каталог
const goBack = () => goToPage(state.currentPage === 'checkoutPage' ? 'cartPage' : null);

export function listenForBackNavigation() {
  onBackButton(() => {
    if (isSheetOpen()) return closeSheet(); // сначала закрываем шторку
    return goBack();
  });
  // Esc на ноутбуке закрывает окно товара (или возвращает назад)
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (isSheetOpen()) closeSheet();
    else if (state.currentPage) goBack();
  });
}

export const navigationActions = {
  'go-to-page': (element) => goToPage(element.dataset.page || null),
};
