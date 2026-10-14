// Обёртка над Telegram WebApp SDK: подписанные данные, вибрация, окна-сообщения, ссылки и кнопка «Назад».
// Вне Telegram (обычный браузер) SDK может не быть — тогда вызовы молча пропускаются или заменяются alert/confirm.

export const telegram = window.Telegram?.WebApp;

export function initTelegram() {
  telegram?.ready();
  telegram?.expand();
}

/** Подписанные данные пользователя для заголовка X-Init-Data ('' — открыто не из Telegram) */
export const telegramInitData = () => telegram?.initData || '';

/** Пользователь Telegram ({ id, first_name, … }) — только для подсказок в форме, сервер проверяет подпись сам */
export const telegramUser = () => telegram?.initDataUnsafe?.user;

/** Лёгкая вибрация при выборе (категория, размер, интервал) */
export const vibrateSelection = () => telegram?.HapticFeedback?.selectionChanged?.();

/** Вибрация-уведомление: 'success' | 'error' | 'warning' */
export const vibrateNotification = (type) => telegram?.HapticFeedback?.notificationOccurred(type);

/** Сообщение в окне Telegram; в браузере — alert с browserMessage (null — ничего не показывать) */
export function showAlert(message, browserMessage = message) {
  if (telegram?.showAlert) telegram.showAlert(message);
  else if (browserMessage !== null) alert(browserMessage);
}

/** Вопрос «да/нет»: в Telegram — родное окно, в браузере — confirm(). onAnswer(true | false) */
export function askConfirmation(question, onAnswer) {
  if (telegram?.showConfirm) telegram.showConfirm(question, onAnswer);
  else onAnswer(confirm(question));
}

/** Внешняя ссылка (страница оплаты ЮKassa) */
export function openExternalLink(url) {
  if (telegram?.openLink) telegram.openLink(url);
  else window.open(url, '_blank');
}

/** Ссылка на профиль в Telegram (t.me/…) */
export function openTelegramLink(url) {
  if (telegram) telegram.openTelegramLink(url);
  else window.open(url);
}

export const showBackButton = () => telegram?.BackButton?.show();
export const hideBackButton = () => telegram?.BackButton?.hide();
export const onBackButton = (callback) => telegram?.BackButton?.onClick(callback);
