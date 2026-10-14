// Мелочи для работы с разметкой: поиск элемента по id и экранирование текста для HTML-шаблонов.

export const getElement = (id) => document.getElementById(id);

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Экранирует текст перед вставкой в HTML-шаблон (и в текст, и в значение атрибута) */
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);

/** Перезапускает CSS-анимацию у элемента: снять класс, дать браузеру заметить и поставить снова */
export function restartAnimation(element, className) {
  element.classList.remove(className);
  void element.offsetWidth; // чтение размера заставляет браузер пересчитать стили
  element.classList.add(className);
}
