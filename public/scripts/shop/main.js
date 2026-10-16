// Точка входа витрины «Флёр»: Telegram, обработчики кликов и полей, первая загрузка каталога, тарифов и «Моих заказов».
import { initTelegram } from '../shared/telegram.js';
import { registerClickActions, listenForClickActions } from '../shared/actions.js';
import { catalogActions, listenToSearchInput } from './catalog/catalog-view.js';
import { loadCatalog } from './catalog/catalog-loader.js';
import { productSheetActions, listenToSheetSwipe } from './catalog/product-sheet.js';
import { stemSheetActions } from './catalog/stem-sheet.js';
import { cartActions } from './cart/cart-actions.js';
import { trackTaps } from './cart/add-effect.js';
import { navigationActions, listenForBackNavigation } from './navigation.js';
import { deliveryQuoteActions, listenToAddressInput, loadDeliveryInfo } from './checkout/delivery-quote.js';
import { checkoutFormActions, listenToCheckoutInputs } from './checkout/checkout-form.js';
import { submitOrderActions, listenToOrderForm } from './checkout/submit-order.js';
import { consentActions, listenToConsentCheckbox } from './checkout/consent.js';
import { myOrdersActions, loadMyOrders } from './orders/my-orders.js';
import { repeatOrderActions, repeatOrder } from './orders/repeat-order.js';

initTelegram();
// каждый модуль отдаёт свои действия для data-action; совпадение имён registerClickActions не пропустит
[
  catalogActions,
  productSheetActions,
  stemSheetActions,
  cartActions,
  navigationActions,
  deliveryQuoteActions,
  checkoutFormActions,
  submitOrderActions,
  consentActions,
  myOrdersActions,
  repeatOrderActions,
].forEach(registerClickActions);
listenForClickActions();
trackTaps();
listenToSearchInput();
listenToSheetSwipe();
listenForBackNavigation();
listenToAddressInput();
listenToCheckoutInputs();
listenToOrderForm();
listenToConsentCheckbox();

loadCatalog().then(() => repeatOrder()); // ссылка «Повторить заказ» из чата — когда каталог уже загружен
loadDeliveryInfo();
loadMyOrders(false);
