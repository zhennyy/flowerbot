// Размеры букета S / M / L в редакторе: строки «название — подпись — цена», добавление и удаление.
import { getElement, escapeHtml } from '../../shared/dom.js';

const SIZE_NAMES = ['S', 'M', 'L', 'XL', 'XXL'];
const SMALL_SIZE_FACTOR = 0.75;
const LARGE_SIZE_FACTOR = 1.4;

export const sizeState = { sizes: [] }; // [{ name, note, price }]

export function renderSizeRows() {
  getElement('sizeRows').innerHTML = sizeState.sizes
    .map(
      (size, sizeIndex) => `
    <div class="srow"><input type="text" value="${escapeHtml(size.name)}" placeholder="M" maxlength="12" data-size-index="${sizeIndex}" data-size-field="name">
      <input type="text" value="${escapeHtml(size.note || '')}" placeholder="напр. 7 цветов, ~35 см" maxlength="40" data-size-index="${sizeIndex}" data-size-field="note">
      <input type="number" value="${size.price || ''}" placeholder="₽" min="1" data-size-index="${sizeIndex}" data-size-field="price">
      <button type="button" class="x" data-action="remove-size" data-size-index="${sizeIndex}" aria-label="Удалить">✕</button></div>`,
    )
    .join('');
}

/** Включили «Есть размеры» у букета без размеров — предлагаем S/M/L от его цены */
export function suggestSizesFromPrice(basePrice) {
  sizeState.sizes = [
    { name: 'S', note: '', price: Math.round(basePrice * SMALL_SIZE_FACTOR) },
    { name: 'M', note: '', price: basePrice },
    { name: 'L', note: '', price: Math.round(basePrice * LARGE_SIZE_FACTOR) },
  ];
}

/** Ввод в строках размеров сразу попадает в sizeState (цена — числом) */
export function listenToSizeInputs() {
  getElement('sizeRows').addEventListener('input', (event) => {
    const { sizeIndex, sizeField } = event.target.dataset;
    if (sizeIndex === undefined) return;
    sizeState.sizes[sizeIndex][sizeField] = sizeField === 'price' ? Number(event.target.value) : event.target.value;
  });
}

export const sizeActions = {
  'add-size': () => {
    sizeState.sizes.push({ name: SIZE_NAMES[sizeState.sizes.length] || '', note: '', price: 0 });
    renderSizeRows();
  },
  'remove-size': (element) => {
    sizeState.sizes.splice(Number(element.dataset.sizeIndex), 1);
    renderSizeRows();
  },
};
