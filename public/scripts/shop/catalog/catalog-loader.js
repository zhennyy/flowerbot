// Загрузка каталога из базы: товары, категории, восстановление сохранённой корзины.
import { state } from '../state.js';
import { getElement } from '../../shared/dom.js';
import { getPublicJson } from '../api.js';
import { showcaseProducts } from './product-helpers.js';
import { renderChips, renderGrid, LOADING_GRID_HTML, LOAD_ERROR_GRID_HTML } from './catalog-view.js';
import { restoreCart } from '../cart/cart-model.js';
import { renderCartBar } from '../cart/cart-view.js';

export async function loadCatalog() {
  getElement('grid').innerHTML = LOADING_GRID_HTML;
  try {
    state.products = await getPublicJson('/products');
    state.categories = [...new Set(showcaseProducts().map((product) => product.category))];
  } catch {
    getElement('grid').innerHTML = LOAD_ERROR_GRID_HTML;
    return;
  }
  if (!Object.keys(state.cart).length) restoreCart();
  renderChips();
  renderGrid();
  renderCartBar();
}
