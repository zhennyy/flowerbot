// Вкладка «Доставка», тарифы: зоны по городу (до N км — цена), Ленобласть (база + за каждый км), бесплатно от суммы.
import { getElement } from '../../shared/dom.js';
import { formatRubles } from '../../shared/format.js';
import { vibrateNotification, showAlert } from '../../shared/telegram.js';
import { callAdminApi } from '../api.js';
import { loadCalendar } from './calendar-settings.js';

const EXAMPLE_DISTANCE_KM = 35;
const NEW_TIER_STEP_KM = 5;
const NEW_TIER_STEP_PRICE = 100;
const REGION_FIELDS = ['r_base', 'r_per', 'r_from'];

let cityTiers = []; // [{ km, price }]

export async function loadDelivery() {
  loadCalendar();
  try {
    const tariff = await callAdminApi('/delivery');
    cityTiers = tariff.city.map((tier) => ({ ...tier }));
    getElement('r_base').value = tariff.region.base;
    getElement('r_per').value = tariff.region.perKm;
    getElement('r_from').value = tariff.region.fromKm;
    getElement('free_from').value = tariff.freeFrom;
    renderTiers();
    showRegionExample();
  } catch (error) {
    getElement('dError').textContent = error.message;
  }
}

function renderTiers() {
  getElement('tiers').innerHTML = cityTiers.map((tier, tierIndex) => `
    <div class="tier">до <input type="number" min="1" value="${tier.km}" data-tier-index="${tierIndex}" data-tier-field="km"> км —
      <input type="number" min="0" value="${tier.price}" data-tier-index="${tierIndex}" data-tier-field="price"> ₽
      <button class="x" type="button" data-action="remove-tier" data-tier-index="${tierIndex}" aria-label="Удалить">✕</button></div>`).join('');
}

// Пример цены для Ленобласти — сразу видно, что получится
function showRegionExample() {
  const [basePrice, pricePerKm, fromKm] = REGION_FIELDS.map((id) => Number(getElement(id).value) || 0);
  getElement('r_example').textContent = `Пример: ${EXAMPLE_DISTANCE_KM} км от магазина → ${formatRubles(basePrice + Math.max(0, EXAMPLE_DISTANCE_KM - fromKm) * pricePerKm)}`;
}

async function saveDelivery() {
  getElement('dError').textContent = '';
  try {
    const tariff = await callAdminApi('/delivery', { method: 'PUT', body: {
      city: cityTiers,
      region: { base: getElement('r_base').value, perKm: getElement('r_per').value, fromKm: getElement('r_from').value },
      freeFrom: getElement('free_from').value,
    } });
    cityTiers = tariff.city;
    renderTiers();
    vibrateNotification('success');
    showAlert('Тарифы сохранены 🚚', 'Сохранено');
  } catch (error) {
    getElement('dError').textContent = error.message;
  }
}

export function listenToTariffInputs() {
  getElement('tiers').addEventListener('input', (event) => {
    const { tierIndex, tierField } = event.target.dataset;
    if (tierIndex !== undefined) cityTiers[tierIndex][tierField] = Number(event.target.value);
  });
  REGION_FIELDS.forEach((id) => getElement(id).addEventListener('input', showRegionExample));
}

export const deliveryTariffActions = {
  'add-tier': () => {
    const lastTier = cityTiers[cityTiers.length - 1];
    cityTiers.push({ km: (lastTier?.km || 0) + NEW_TIER_STEP_KM, price: (lastTier?.price || 0) + NEW_TIER_STEP_PRICE });
    renderTiers();
  },
  'remove-tier': (element) => {
    cityTiers.splice(Number(element.dataset.tierIndex), 1);
    renderTiers();
  },
  'save-delivery': () => saveDelivery(),
};
