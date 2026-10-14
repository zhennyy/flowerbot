// Вкладка «Доставка», календарь: выходные дни, лимит заказов на интервал и сколько ждать ответа на фото букета.
import { getElement } from '../../shared/dom.js';
import { formatDate } from '../../shared/format.js';
import { vibrateNotification, showAlert } from '../../shared/telegram.js';
import { callAdminApi } from '../api.js';

let closedDates = []; // ['2026-12-31', …]

async function loadPhotoTimeout() {
  try {
    getElement('ph_timeout').value = (await callAdminApi('/photo-timeout')).minutes;
  } catch { /* поле останется пустым */ }
}

export async function loadCalendar() {
  loadPhotoTimeout();
  try {
    const calendar = await callAdminApi('/calendar');
    closedDates = calendar.closed;
    getElement('c_limit').value = calendar.slotLimit;
    renderClosedDates();
  } catch { /* покажем пустой список */ }
}

// Прошедшие выходные не показываем
function renderClosedDates() {
  const today = new Date().toISOString().slice(0, 10);
  getElement('closedList').innerHTML = closedDates.filter((date) => date >= today).map((date) => `<span class="chipd">${formatDate(date)}<button type="button" data-action="open-date" data-date="${date}" aria-label="Открыть дату">✕</button></span>`).join('')
    || '<div class="meta">Выходных нет — работаем каждый день</div>';
}

function addClosedDate() {
  const date = getElement('c_date').value;
  if (!date || closedDates.includes(date)) return;
  closedDates.push(date);
  closedDates.sort();
  renderClosedDates();
}

async function saveCalendar() {
  getElement('cError').textContent = '';
  try {
    const calendar = await callAdminApi('/calendar', { method: 'PUT', body: { closed: closedDates, slotLimit: getElement('c_limit').value } });
    closedDates = calendar.closed;
    renderClosedDates();
    vibrateNotification('success');
    showAlert('Календарь сохранён 📅', 'Сохранено');
  } catch (error) {
    getElement('cError').textContent = error.message;
  }
}

async function savePhotoTimeout() {
  try {
    const { minutes } = await callAdminApi('/photo-timeout', { method: 'PUT', body: { minutes: getElement('ph_timeout').value } });
    getElement('ph_timeout').value = minutes;
    vibrateNotification('success');
    showAlert(minutes ? `Ждём ответа ${minutes} мин, потом отправляем как на фото 📸` : 'Будем ждать ответа покупателя без ограничения', null);
  } catch (error) {
    showAlert(error.message);
  }
}

export const calendarActions = {
  'add-closed-date': () => addClosedDate(),
  'open-date': (element) => {
    closedDates = closedDates.filter((date) => date !== element.dataset.date);
    renderClosedDates();
  },
  'save-calendar': () => saveCalendar(),
  'save-photo-timeout': () => savePhotoTimeout(),
};
