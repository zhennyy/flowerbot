// Форма оформления: подстановка имени/телефона/адреса, дата («Сегодня» / «Завтра» / календарь),
// свободные интервалы с сервера, получатель и открытка.
import { getElement } from '../../shared/dom.js';
import { telegramUser, vibrateSelection } from '../../shared/telegram.js';
import { getPublicJson } from '../api.js';
import { savedField } from '../cart/cart-model.js';
import { checkoutState, TIME_SLOTS } from './checkout-state.js';
import { requestQuote, updateSubmitButton } from './delivery-quote.js';

const DAY_MS = 864e5;
const MIN_HOURS_BEFORE_SLOT_END = 2; // сегодня нельзя выбрать интервал, который закончится меньше чем через 2 часа
const LOW_SLOT_PLACES = 3;

/** Дата в формате поля <input type="date"> по местному времени */
const toInputDate = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

export function prepareCheckout() {
  const user = telegramUser();
  if (!getElement('f_name').value) getElement('f_name').value = savedField.get('name') || user?.first_name || '';
  if (!getElement('f_phone').value) getElement('f_phone').value = savedField.get('phone');
  if (!getElement('f_address').value) getElement('f_address').value = savedField.get('address');
  const today = new Date();
  const tomorrow = new Date(Date.now() + DAY_MS);
  const dateInput = getElement('f_date');
  dateInput.min = toInputDate(today);
  if (!dateInput.value) dateInput.value = toInputDate(today);
  getElement('days').innerHTML = [['Сегодня', today], ['Завтра', tomorrow]].map(([label, date]) => `<button type="button" class="slot ${dateInput.value === toInputDate(date) ? 'active' : ''}" data-action="pick-date" data-date="${toInputDate(date)}">${label}</button>`).join('');
  loadSlots();
  updateSubmitButton();
  if (!checkoutState.quote && getElement('f_address').value.trim()) requestQuote(0);
}

// Свободные интервалы приходят с сервера: выходные и «нет мест» показываем сразу
async function loadSlots() {
  const date = getElement('f_date').value;
  if (!date) return;
  if (checkoutState.dayInfoDate !== date) {
    checkoutState.dayInfoDate = date;
    checkoutState.dayInfo = null;
    renderSlots();
    try {
      checkoutState.dayInfo = await getPublicJson(`/slots?date=${date}`);
    } catch { /* без ответа сервера показываем все интервалы */ }
    if (getElement('f_date').value !== date) return; // пока ждали, выбрали другую дату
  }
  renderSlots();
}

function slotNoteHtml(slotInfo, isFull, isUnavailable) {
  if (isFull && !checkoutState.dayInfo.closed) return '<small>нет мест</small>';
  if (slotInfo?.left != null && slotInfo.left <= LOW_SLOT_PLACES && !isUnavailable) return `<small>осталось ${slotInfo.left}</small>`;
  return '';
}

function renderSlots() {
  const { dayInfo } = checkoutState;
  const isToday = getElement('f_date').value === toInputDate(new Date());
  const currentHour = new Date().getHours();
  getElement('slotsNote').textContent = dayInfo?.closed ? '🌿 В этот день мы не работаем — выберите другую дату' : '';
  getElement('slots').innerHTML = TIME_SLOTS.map((slot) => {
    const slotInfo = dayInfo?.slots?.find((info) => info.time === slot);
    const isTooSoon = isToday && parseInt(slot.split('–')[1], 10) <= currentHour + MIN_HOURS_BEFORE_SLOT_END;
    const isFull = slotInfo && !slotInfo.available;
    const isUnavailable = isTooSoon || isFull;
    if (isUnavailable && checkoutState.slot === slot) checkoutState.slot = '';
    return `<button type="button" class="slot ${checkoutState.slot === slot ? 'active' : ''}" ${isUnavailable ? 'disabled' : ''} data-action="pick-slot" data-slot="${slot}">${slot}${slotNoteHtml(slotInfo, isFull, isUnavailable)}</button>`;
  }).join('');
}

function pickDate(date) {
  getElement('f_date').value = date;
  vibrateSelection();
  prepareCheckout();
}

export function listenToCheckoutInputs() {
  getElement('f_date').addEventListener('change', () => prepareCheckout());
  getElement('t_recipient').addEventListener('change', (event) => getElement('recipientBox').classList.toggle('hidden', !event.target.checked));
  getElement('t_card').addEventListener('change', (event) => getElement('cardBox').classList.toggle('hidden', !event.target.checked));
  getElement('f_card').addEventListener('input', (event) => { getElement('cardCount').textContent = event.target.value.length; });
}

/** После заказа интервалы перезагрузятся (места могли закончиться) */
export function resetSlotChoice() {
  checkoutState.slot = '';
  checkoutState.dayInfoDate = '';
}

export const checkoutFormActions = {
  'pick-date': (element) => pickDate(element.dataset.date),
  'pick-slot': (element) => {
    checkoutState.slot = element.dataset.slot;
    vibrateSelection();
    renderSlots();
  },
};
