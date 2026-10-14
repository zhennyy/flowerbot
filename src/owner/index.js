// Владелица магазина (флорист): OWNER_ID из .env — ей приходят заказы и сообщения, ей открыта админка
const getOwnerId = () => process.env.OWNER_ID || null;
const isOwner = (userId) => Boolean(getOwnerId()) && String(userId) === String(getOwnerId());

module.exports = { getOwnerId, isOwner };
