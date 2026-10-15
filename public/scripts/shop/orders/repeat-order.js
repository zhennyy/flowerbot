// «Повторить заказ»: собираем ту же корзину (кнопка в «Мои заказы» или ссылка из чата — витрина открывается с ?repeat=12).
import { state } from '../state.js';
import { getElement } from '../../shared/dom.js';
import { pluralize } from '../../shared/format.js';
import { telegramInitData, showAlert } from '../../shared/telegram.js';
import { requestShopApi } from '../api.js';
import { findProduct, hasSizes, cartKey, minQuantity, maxQuantity } from '../catalog/product-helpers.js';
import { refreshCartViews } from '../cart/cart-actions.js';
import { showSelectedZone } from '../checkout/delivery-quote.js';
import { checkoutState } from '../checkout/checkout-state.js';
import { goToPage } from '../navigation.js';

/** Корзина из позиций старого заказа; возвращает, сколько позиций уже нет в наличии */
function fillCartFromOrder(order) {
  state.cart = {};
  let missingCount = 0;
  for (const item of order.items) {
    const product = findProduct(item.id);
    if (!product) {
      missingCount++;
      continue;
    }
    state.cart[cartKey(item.id, hasSizes(product) ? item.size : null)] = Math.min(
      maxQuantity(product),
      Math.max(item.qty, minQuantity(product)),
    );
  }
  return missingCount;
}

// Адрес, зона и получатель — как в прошлый раз
function fillDeliveryFromOrder(order) {
  getElement('f_address').value = order.address;
  checkoutState.zone = order.zone;
  showSelectedZone();
  if (order.recipient) {
    getElement('t_recipient').checked = true;
    getElement('recipientBox').classList.remove('hidden');
    getElement('f_recipient').value = order.recipient;
  }
}

/** orderId — из кнопки «Повторить»; без него — из адреса витрины (?repeat=…) */
export async function repeatOrder(orderId) {
  const repeatId = orderId || new URLSearchParams(window.location.search).get('repeat');
  if (!repeatId || !telegramInitData()) return;
  try {
    const response = await requestShopApi(`/my-orders/${encodeURIComponent(repeatId)}`, { signed: true });
    if (!response.ok) return;
    const order = await response.json();
    const missingCount = fillCartFromOrder(order);
    fillDeliveryFromOrder(order);
    refreshCartViews();
    if (Object.keys(state.cart).length) goToPage('cartPage');
    showAlert(
      missingCount
        ? `Собрали корзину по заказу №${order.id} 🌷 ${missingCount} ${pluralize(missingCount, ['позиции', 'позиций', 'позиций'])} уже нет в наличии — выберите замену в каталоге`
        : `Собрали корзину по заказу №${order.id} 🌷 Проверьте и оформляйте!`,
    );
  } catch {
    /* не получилось — покупатель соберёт корзину сам */
  }
}

export const repeatOrderActions = {
  'repeat-order': (element) => repeatOrder(Number(element.dataset.orderId)),
};
