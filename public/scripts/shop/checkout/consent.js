// Согласие на обработку персональных данных (152-ФЗ): галочка над кнопкой «Заказать» не стоит заранее,
// и пока её нет, кнопка неактивна. Ссылки на документы открываются вне мини-приложения (Telegram.WebApp.openLink).
import { getElement } from '../../shared/dom.js';
import { openExternalLink } from '../../shared/telegram.js';

export const hasConsent = () => getElement('t_consent').checked;

/** Кнопка «Заказать» доступна только с галочкой согласия */
export function updateConsentLock() {
  getElement('submitBtn').disabled = !hasConsent();
}

/** После заказа галочку снимаем: следующий заказ — новое согласие */
export function resetConsent() {
  getElement('t_consent').checked = false;
  updateConsentLock();
}

export function listenToConsentCheckbox() {
  getElement('t_consent').addEventListener('change', updateConsentLock);
  updateConsentLock();
}

export const consentActions = {
  // «согласие», «оферта», «политика» — страницы из public/legal/ полным адресом
  'open-legal': (element, event) => {
    event.preventDefault();
    openExternalLink(new URL(element.getAttribute('href'), window.location.href).toString());
  },
};
