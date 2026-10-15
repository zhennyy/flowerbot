// Действия с заказом: смена статуса, отмена, «в доставку без одобрения фото», фото букета на согласование, чат с покупателем.
import { getElement } from '../../shared/dom.js';
import { vibrateNotification, showAlert, askConfirmation } from '../../shared/telegram.js';
import { callAdminApi } from '../api.js';
import { readImageFile, resizeToJpeg } from '../photo-files.js';
import { orderState, renderOrders, replaceOrder } from './order-list.js';
import { openChatAboutOrder } from '../chats/chat-thread.js';

const BOUQUET_PHOTO_SIDE = 1600;
const BOUQUET_PHOTO_QUALITY = 0.85;
let photoOrderId = null; // для какого заказа выбирается фото букета

async function setOrderStatus(orderId, status) {
  try {
    replaceOrder(await callAdminApi(`/orders/${orderId}/status`, { method: 'POST', body: { status } }));
    vibrateNotification('success');
    renderOrders();
  } catch (error) {
    showAlert(error.message);
  }
}

function deliverWithoutApproval(orderId) {
  askConfirmation(
    'Покупатель ещё не ответил на фото. Передать букет курьеру без одобрения?',
    (confirmed) => confirmed && setOrderStatus(orderId, 'delivering'),
  );
}

function cancelOrder(orderId) {
  askConfirmation(
    `Отменить заказ №${orderId}? Покупатель получит уведомление, цветы вернутся на склад.`,
    (confirmed) => confirmed && setOrderStatus(orderId, 'cancelled'),
  );
}

// Фото букета с телефона → покупателю на согласование
function pickBouquetPhoto(orderId) {
  photoOrderId = orderId;
  getElement('bouquetFile').click();
}

async function sendBouquetPhoto(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file || !photoOrderId) return;
  const orderId = photoOrderId;
  photoOrderId = null;
  try {
    const image = await readImageFile(file);
    const updatedOrder = await callAdminApi(`/orders/${orderId}/photo`, {
      method: 'POST',
      body: { full: resizeToJpeg(image, BOUQUET_PHOTO_SIDE, BOUQUET_PHOTO_QUALITY) },
    });
    replaceOrder(updatedOrder);
    renderOrders();
    vibrateNotification('success');
    showAlert('Фото отправлено покупателю 📸 Как только он ответит — придёт уведомление', null);
  } catch (error) {
    showAlert(error.message || 'Не получилось отправить фото', error.message);
  }
}

export const listenToBouquetPhotoInput = () => getElement('bouquetFile').addEventListener('change', sendBouquetPhoto);

const orderIdOf = (element) => Number(element.dataset.orderId);

export const orderActions = {
  'set-order-status': (element) => setOrderStatus(orderIdOf(element), element.dataset.status),
  'deliver-without-approval': (element) => deliverWithoutApproval(orderIdOf(element)),
  'cancel-order': (element) => cancelOrder(orderIdOf(element)),
  'pick-bouquet-photo': (element) => pickBouquetPhoto(orderIdOf(element)),
  // Написать покупателю — прямо в «Чатах» админки
  'chat-about-order': (element) =>
    openChatAboutOrder(orderState.orders.find((order) => order.id === orderIdOf(element))),
};
