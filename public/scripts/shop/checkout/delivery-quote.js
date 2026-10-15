// Доставка: цена зависит от расстояния от магазина — считает сервер по адресу, пока покупатель его вводит.
// Здесь же — тарифы для подсказки в корзине, блок «Оплата» и надпись на кнопке «Заказать».
import { getElement, escapeHtml } from '../../shared/dom.js';
import { formatRubles, formatKilometers } from '../../shared/format.js';
import { telegramInitData, vibrateSelection } from '../../shared/telegram.js';
import { requestShopApi, getPublicJson } from '../api.js';
import { cartTotal, cartItemsForServer } from '../cart/cart-model.js';
import { checkoutState } from './checkout-state.js';

const TYPING_PAUSE_MS = 1200; // ждём, пока человек допечатает
const MIN_ADDRESS_LENGTH = 5;
const ADDRESS_PLACEHOLDERS = {
  city: 'Улица, дом, квартира, подъезд, этаж',
  region: 'Город/посёлок, улица, дом, квартира',
};
let quoteTimer = null;
let quoteRequestNumber = 0;

export function updateSubmitButton() {
  const deliveryFee = checkoutState.quote?.fee || 0;
  getElement('submitBtn').textContent =
    `${checkoutState.payOnline ? 'Перейти к оплате' : 'Заказать'} · ${formatRubles(cartTotal() + deliveryFee)}`;
}

export function showSelectedZone() {
  document
    .querySelectorAll('#zones .slot')
    .forEach((button) => button.classList.toggle('active', button.dataset.zone === checkoutState.zone));
}

function quoteHtml(quote) {
  if (quote.fee == null) return escapeHtml(quote.error);
  return `🚚 Доставка: <b>${quote.free ? 'бесплатно 🎉' : formatRubles(quote.fee)}</b> · ${formatKilometers(quote.km)} км от магазина
           <small>Нашли: ${escapeHtml(quote.found)}</small>${!quote.free && quote.freeFrom ? `<small>Бесплатно от ${formatRubles(quote.freeFrom)}</small>` : ''}`;
}

export function requestQuote(delayMs) {
  clearTimeout(quoteTimer);
  checkoutState.quote = null;
  updateSubmitButton();
  const address = getElement('f_address').value.trim();
  const quoteBox = getElement('quote');
  if (address.length < MIN_ADDRESS_LENGTH || !telegramInitData()) {
    quoteBox.classList.add('hidden');
    return;
  }
  quoteTimer = setTimeout(async () => {
    const requestNumber = ++quoteRequestNumber; // если человек продолжил печатать — старый ответ игнорируем
    quoteBox.className = 'quote';
    quoteBox.textContent = 'Считаем доставку…';
    try {
      const response = await requestShopApi('/delivery-quote', {
        signed: true,
        body: { address, zone: checkoutState.zone, items: cartItemsForServer() },
      });
      const quote = await response.json();
      if (requestNumber !== quoteRequestNumber) return;
      if (!response.ok) throw new Error(quote.error || 'Не удалось рассчитать доставку');
      checkoutState.quote = quote;
      quoteBox.innerHTML = quoteHtml(quote);
    } catch (error) {
      if (requestNumber !== quoteRequestNumber) return;
      quoteBox.className = 'quote err';
      quoteBox.textContent = error.message;
    }
    updateSubmitButton();
  }, delayMs);
}

function selectZone(zone) {
  checkoutState.zone = zone;
  vibrateSelection();
  showSelectedZone();
  getElement('f_address').placeholder = ADDRESS_PLACEHOLDERS[zone];
  requestQuote(0);
}

export function listenToAddressInput() {
  const addressInput = getElement('f_address');
  addressInput.addEventListener('input', () => requestQuote(TYPING_PAUSE_MS));
  addressInput.addEventListener('blur', () => requestQuote(0));
}

/** Тарифы — для подсказки «Доставка от … ₽» в корзине; без онлайн-оплаты — оплата по договорённости с флористом */
export async function loadDeliveryInfo() {
  try {
    const deliveryInfo = await getPublicJson('/delivery-info');
    getElement('deliveryHint').textContent =
      `от ${formatRubles(Math.min(...deliveryInfo.city.map((tier) => tier.price)))} · по адресу`;
    checkoutState.payOnline = Boolean(deliveryInfo.payOnline);
    if (!checkoutState.payOnline) {
      getElement('payOnline').outerHTML =
        `<div class="paym on"><div class="pm-ic">🤝</div><div><b>При получении или по договорённости</b>
        <div class="pm-sub">Флорист свяжется с вами и подскажет, как удобнее оплатить</div></div><span class="pm-ok">✓</span></div>`;
      getElement('payNote').textContent = '';
    }
    updateSubmitButton();
  } catch {
    /* без тарифов витрина работает, подсказка останется «рассчитаем по адресу» */
  }
}

export const deliveryQuoteActions = {
  'select-zone': (element) => selectZone(element.dataset.zone),
};
