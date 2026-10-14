// Настройки магазина (ключ → JSON): календарь, тарифы доставки, ожидание ответа по фото, служебные отметки
const { database } = require('../database');

async function getSetting(key, fallbackValue) {
  const setting = await database.setting.findUnique({ where: { key } });
  if (!setting) return fallbackValue;
  try {
    return JSON.parse(setting.value);
  } catch {
    return fallbackValue;
  }
}

async function setSetting(key, value) {
  const serializedValue = JSON.stringify(value);
  await database.setting.upsert({ where: { key }, create: { key, value: serializedValue }, update: { value: serializedValue } });
}

module.exports = { getSetting, setSetting };
