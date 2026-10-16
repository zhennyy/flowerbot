// Отправка заказа и экран «Спасибо»: с онлайн-оплатой — кнопка «Оплатить» ведёт на страницу ЮKassa.
// Без галочки согласия на обработку данных заказ не уходит (сервер тоже проверит).
import { state } from '../state.js';
import { getElement } from '../../shared/dom.js';
import { formatRubles } from '../../shared/format.js';
import { telegramInitData, vibrateNotification, openExternalLink } from '../../shared/telegram.js';
import { requestShopApi } from '../api.js';
import { cartItemsForServer, savedField } from '../cart/cart-model.js';
import { refreshCartViews } from '../cart/cart-actions.js';
import { goToPage } from '../navigation.js';
import { loadCatalog } from '../catalog/catalog-loader.js';
import { loadMyOrders } from '../orders/my-orders.js';
import { checkoutState } from './checkout-state.js';
import { updateSubmitButton } from './delivery-quote.js';
import { resetSlotChoice } from './checkout-form.js';
import { hasConsent, resetConsent, updateConsentLock } from './consent.js';

let newOrderPayUrl = null;

function readOrderForm() {
  const fieldValue = (id) => getElement(id).value;
  return {
    items: cartItemsForServer(),
    customer_name: fieldValue('f_name'),
    phone: fieldValue('f_phone'),
    address: fieldValue('f_address'),
    delivery_date: fieldValue('f_date'),
    delivery_time: checkoutState.slot,
    delivery_zone: checkoutState.zone,
    recipient: getElement('t_recipient').checked ? fieldValue('f_recipient') : '',
    card_text: getElement('t_card').checked ? fieldValue('f_card') : '',
    comment: fieldValue('f_comment'),
    consent: hasConsent(),
  };
}

/** Что проверить до отправки: текст ошибки или '' */
function findFormProblem() {
  if (!hasConsent()) return 'Отметьте согласие на обработку данных';
  if (!checkoutState.slot) return 'Выберите время доставки';
  if (getElement('quote').classList.contains('err')) {
    getElement('f_address').focus();
    return 'Проверьте адрес доставки';
  }
  if (!telegramInitData()) return 'Откройте магазин через кнопку в Telegram-боте';
  return '';
}

// Заказ принят: очищаем корзину и открытку, обновляем остатки в каталоге и «Мои заказы»
function resetAfterOrder(order) {
  savedField.set('name', order.customer_name);
  savedField.set('phone', order.phone);
  savedField.set('address', order.address);
  state.cart = {};
  refreshCartViews();
  resetSlotChoice();
  loadCatalog();
  loadMyOrders(false);
  getElement('f_card').value = '';
  getElement('f_comment').value = '';
  getElement('t_card').checked = false;
  getElement('cardBox').classList.add('hidden');
  resetConsent();
}

function showDonePage(result) {
  const needsPayment = Boolean(result.pay_url);
  getElement('doneTitle').textContent = needsPayment ? `Заказ №${result.id} оформлен!` : `Заказ №${result.id} принят!`;
  getElement('payBtn').classList.toggle('hidden', !needsPayment);
  getElement('backBtn').classList.toggle('ghost', needsPayment);
  getElement('doneText').innerHTML = needsPayment
    ? 'Осталось оплатить — после оплаты флорист сразу возьмётся за букет.<br>Неоплаченный заказ отменится через 30 минут.'
    : 'Подтверждение уже в чате с ботом.<br>Мы свяжемся с вами в ближайшее время.';
  if (needsPayment) {
    getElement('payBtn').textContent = `💳 Оплатить ${formatRubles(result.total)}`;
    newOrderPayUrl = result.pay_url;
  }
  vibrateNotification('success');
  goToPage('donePage');
}

async function submitOrder(event) {
  event.preventDefault();
  const errorBox = getElement('formError');
  errorBox.textContent = '';
  const problem = findFormProblem();
  if (problem) {
    errorBox.textContent = problem;
    return;
  }
  const order = readOrderForm();
  const submitButton = getElement('submitBtn');
  submitButton.disabled = true;
  submitButton.textContent = 'Отправляем…';
  try {
    const response = await requestShopApi('/orders', { signed: true, body: order });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не получилось оформить заказ');
    resetAfterOrder(order);
    showDonePage(result);
  } catch (error) {
    errorBox.textContent = error.message;
    vibrateNotification('error');
  } finally {
    updateConsentLock();
    updateSubmitButton();
  }
}

export const listenToOrderForm = () => getElement('orderForm').addEventListener('submit', submitOrder);

export const submitOrderActions = {
  // Онлайн-оплата: после оплаты подтверждение придёт в чат
  'pay-new-order': () => {
    if (newOrderPayUrl) openExternalLink(newOrderPayUrl);
  },
};
