// Фоновые задачи по расписанию (раз в минуту): отзывы, фото без ответа, утренняя сводка, напоминания о поводах, проверка оплат
const { askDueReviews } = require('../reviews');
const { checkPhotoTimeouts } = require('../bouquet-photo');
const { sendMorningSummary } = require('../summary');
const { sendDueReminders } = require('../reminders');
const { checkUnpaidPayments } = require('../payments');

const ONE_MINUTE_MS = 60000;
const FIRST_RUN_DELAY_MS = 10000;

// Чат: отзывы, фото, сводка, напоминания — по очереди, ошибка одной задачи не мешает следующему запуску
async function runChatTasks(bot) {
  try {
    await askDueReviews(bot);
    await checkPhotoTimeouts(bot);
    await sendMorningSummary(bot);
    await sendDueReminders(bot);
  } catch (taskError) {
    console.error('Фоновая задача:', taskError.message);
  }
}

async function runPaymentCheck(bot) {
  try {
    await checkUnpaidPayments(bot);
  } catch (paymentError) {
    console.error('Проверка оплаты:', paymentError.message);
  }
}

function startSchedulers(bot) {
  const timers = [
    setInterval(() => runChatTasks(bot), ONE_MINUTE_MS),
    setTimeout(() => runChatTasks(bot), FIRST_RUN_DELAY_MS),
    setInterval(() => runPaymentCheck(bot), ONE_MINUTE_MS),
  ];
  timers.forEach((timer) => timer.unref());
  return () => timers.forEach(clearTimeout);
}

module.exports = { startSchedulers, runChatTasks, runPaymentCheck };
