// Всё «живое» общение в чате: кнопки под сообщениями, повтор заказа, связь с флористом,
// фото букета, отзывы после доставки и напоминания о поводах через год.
const { Markup } = require('telegraf');
const db = require('./db');

const REVIEW_DELAY_MIN = 120; // через сколько минут после «Доставлен» спросить отзыв
const OCCASIONS = { bd: '🎂 День рождения', an: '💍 Годовщина', ot: '🌷 Другой повод' };

module.exports = function setupChat(bot, { OWNER_ID, WEBAPP_URL, orderText, esc }) {
  const isOwner = (id) => OWNER_ID && String(id) === String(OWNER_ID);
  const fmt = (d) => d.split('-').reverse().join('.');

  // Ссылка на витрину с параметром, например ?repeat=12
  const shopUrl = (params = {}) => {
    const u = new URL(WEBAPP_URL);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  };

  // ─── Кнопки под сообщениями покупателю ─────────────────
  function buyerKeyboard(order) {
    const rows = [];
    if (order && ['done', 'cancelled'].includes(order.status)) {
      rows.push([Markup.button.webApp('🔁 Повторить заказ', shopUrl({ repeat: order.id }))]);
    }
    if (order && order.status === 'new' && !db.getReminderByOrder(order.id)) {
      rows.push([Markup.button.callback('🔔 Напомнить о дате через год', `rem:${order.id}`)]);
    }
    rows.push([
      Markup.button.webApp('💐 Магазин', shopUrl()),
      Markup.button.callback('📦 Мои заказы', 'my_orders'),
    ]);
    rows.push([Markup.button.callback('💬 Написать флористу', `ask:${order ? order.id : 0}`)]);
    return Markup.inlineKeyboard(rows);
  }

  // Под подтверждением заказа — только то, что нужно сейчас
  function orderKeyboard(order) {
    const rows = [];
    if (!db.getReminderByOrder(order.id)) rows.push([Markup.button.callback('🔔 Напомнить о дате через год', `rem:${order.id}`)]);
    rows.push([Markup.button.callback('💬 Вопрос по заказу', `ask:${order.id}`)]);
    return Markup.inlineKeyboard(rows);
  }

  // ─── «Режимы ожидания»: бот ждёт от человека текст или фото ───
  // Например, после «Написать флористу» следующее сообщение уйдёт флористу.
  const waiting = new Map(); // userId → { type, orderId, toUser, until }
  const wait = (userId, data) => waiting.set(String(userId), { ...data, until: Date.now() + 15 * 60_000 });
  const takeWaiting = (userId) => {
    const w = waiting.get(String(userId));
    if (!w || w.until < Date.now()) { waiting.delete(String(userId)); return null; }
    return w;
  };
  const ownOrder = (ctx, id) => { // заказ принадлежит этому покупателю?
    const o = db.getOrder(Number(id));
    return o && String(o.user_id) === String(ctx.from.id) ? o : null;
  };

  // ─── Переписка покупатель ⇄ флорист (всё сохраняется для вкладки «Чаты» в админке) ───
  const adminUrl = (params = {}) => {
    const u = new URL('admin.html', WEBAPP_URL.endsWith('/') ? WEBAPP_URL : WEBAPP_URL + '/');
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  };
  const nameOf = (from) => `${from.first_name || ''} ${from.last_name || ''}`.trim() || 'Покупатель';

  // не больше 20 сообщений флористу за 10 минут от одного человека — защита от флуда
  const chatHits = new Map();
  const tooChatty = (id) => {
    const now = Date.now(), arr = (chatHits.get(id) || []).filter((t) => now - t < 600000);
    arr.push(now); chatHits.set(id, arr);
    if (chatHits.size > 5000) chatHits.clear();
    return arr.length > 20;
  };
  async function fromBuyer(ctx, { text = null, photo = null, orderId = null }) {
    if (tooChatty(String(ctx.from.id))) return ctx.reply('Слишком много сообщений подряд — флорист ответит, как освободится 🌷');
    db.addMessage({ user_id: ctx.from.id, name: nameOf(ctx.from), username: ctx.from.username || null,
                    order_id: orderId || null, direction: 'in', text, photo });
    if (OWNER_ID) {
      const who = `${esc(nameOf(ctx.from))}${ctx.from.username ? ' (@' + esc(ctx.from.username) + ')' : ''}`;
      const head = `💬 ${who}${orderId ? ` · заказ №${orderId}` : ''}`;
      const kb = Markup.inlineKeyboard([
        Markup.button.callback('↩️ Ответить', `reply:${ctx.from.id}:${orderId || 0}`),
        Markup.button.webApp('📬 Открыть чат', adminUrl({ chat: ctx.from.id })),
      ]);
      if (photo) await bot.telegram.sendPhoto(OWNER_ID, photo, { caption: `${head}${text ? '\n\n' + esc(text) : ''}`, parse_mode: 'HTML', ...kb }).catch(() => {});
      else await bot.telegram.sendMessage(OWNER_ID, `${head}:\n\n${esc(text.slice(0, 3000))}`, { parse_mode: 'HTML', ...kb }).catch(() => {});
    }
    return ctx.reply('Передала флористу ✅ Ответ придёт сюда, в этот чат', Markup.inlineKeyboard([
      [Markup.button.webApp('💐 Магазин', shopUrl()), Markup.button.callback('📦 Мои заказы', 'my_orders')],
    ]));
  }

  // Ответ флориста покупателю — из чата бота или из админки
  async function toBuyer(userId, text, orderId = null) {
    await bot.telegram.sendMessage(userId,
      `💬 <b>Флорист «Флёр»</b>${orderId ? ` · заказ №${orderId}` : ''}:\n\n${esc(text.slice(0, 3000))}`,
      { parse_mode: 'HTML' });
    db.addMessage({ user_id: userId, order_id: orderId || null, direction: 'out', text: text.slice(0, 3000), is_read: 1 });
  }

  // ─── Мои заказы ────────────────────────────────────────
  async function sendMyOrders(ctx) {
    const list = db.getUserOrders(ctx.from.id).slice(0, 5);
    if (!list.length) {
      return ctx.reply('У вас пока нет заказов 🌿', Markup.inlineKeyboard([Markup.button.webApp('💐 Открыть магазин', shopUrl())]));
    }
    for (const o of list.reverse()) {
      const kb = [[Markup.button.webApp('🔁 Повторить', shopUrl({ repeat: o.id })), Markup.button.callback('💬 Вопрос', `ask:${o.id}`)]];
      await ctx.reply(orderText(o), { parse_mode: 'HTML', ...Markup.inlineKeyboard(kb) });
    }
  }
  bot.command('orders', sendMyOrders);
  bot.action('my_orders', async (ctx) => { await ctx.answerCbQuery(); return sendMyOrders(ctx); });

  // ─── Связь с флористом (через бота, без раскрытия контактов) ───
  bot.action(/^ask:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const orderId = Number(ctx.match[1]);
    wait(ctx.from.id, { type: 'ask', orderId });
    return ctx.reply(`Напишите сообщение${orderId ? ` по заказу №${orderId}` : ''} — я передам флористу 💬\nМожно и фото`);
  });
  bot.action(/^reply:(\d+):(\d+)$/, async (ctx) => {
    if (!isOwner(ctx.from.id)) return ctx.answerCbQuery('Только для владелицы');
    await ctx.answerCbQuery();
    wait(ctx.from.id, { type: 'reply', toUser: ctx.match[1], orderId: Number(ctx.match[2]) });
    return ctx.reply('Напишите ответ — отправлю покупателю ✍️');
  });

  // ─── Фото готового букета покупателю ───────────────────
  bot.action(/^photo:(\d+)$/, async (ctx) => {
    if (!isOwner(ctx.from.id)) return ctx.answerCbQuery('Только для владелицы');
    await ctx.answerCbQuery();
    wait(ctx.from.id, { type: 'photo', orderId: Number(ctx.match[1]) });
    return ctx.reply(`Пришлите фото букета для заказа №${ctx.match[1]} 📸`);
  });

  // Фото на согласование: покупатель отвечает «всё отлично» или «хочу изменить»
  // photo — file_id из Telegram или { source: Buffer } (загрузка из админки)
  async function sendBouquetPhoto(orderId, photo) {
    const o = db.getOrder(orderId);
    if (!o) throw new Error(`Заказ №${orderId} не найден`);
    const msg = await bot.telegram.sendPhoto(o.user_id, photo, {
      caption: `📸 <b>Ваш букет к заказу №${o.id} готов!</b>\nПосмотрите, всё ли нравится? Курьера отправим сразу после вашего ответа 🌷`,
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        Markup.button.callback('👍 Всё отлично!', `ph:ok:${o.id}`),
        Markup.button.callback('✏️ Хочу изменить', `ph:no:${o.id}`),
      ]),
    });
    const fileId = msg.photo.at(-1).file_id;
    db.setBouquetPhoto(o.id, fileId);
    db.addMessage({ user_id: o.user_id, order_id: o.id, direction: 'out', text: '📸 Фото букета на согласование', photo: fileId, is_read: 1 });
    return db.getOrder(o.id);
  }

  // Ответ покупателя на фото
  bot.action(/^ph:(ok|no):(\d+)$/, async (ctx) => {
    const o = ownOrder(ctx, ctx.match[2]);
    if (!o) return ctx.answerCbQuery('Заказ не найден');
    const ok = ctx.match[1] === 'ok';
    db.setPhotoStatus(o.id, ok ? 'approved' : 'changes');
    await ctx.answerCbQuery(ok ? 'Спасибо! 🌷' : 'Поправим 💐');
    await ctx.editMessageCaption(
      `📸 <b>Букет к заказу №${o.id}</b>\n${ok ? '✅ Вы одобрили букет — передаём курьеру 🚚' : '✏️ Флорист переделает букет и пришлёт новое фото'}`,
      { parse_mode: 'HTML' }).catch(() => {});
    db.addMessage({ user_id: o.user_id, name: nameOf(ctx.from), username: ctx.from.username || null, order_id: o.id,
                    direction: 'in', text: ok ? '👍 Букет одобрен' : '✏️ Просит изменить букет' });
    if (OWNER_ID) {
      await bot.telegram.sendMessage(OWNER_ID, ok
        ? `👍 <b>Покупатель одобрил букет</b> · заказ №${o.id}\nМожно отправлять курьера`
        : `✏️ <b>Покупатель просит изменить букет</b> · заказ №${o.id}\nЖдём комментарий — он придёт в чат`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([ ok
          ? [Markup.button.callback('🚚 В доставку', `st:${o.id}:delivering`)]
          : [Markup.button.webApp('📬 Открыть чат', adminUrl({ chat: o.user_id })), Markup.button.callback('📸 Новое фото', `photo:${o.id}`)] ]) })
        .catch(() => {});
    }
    if (!ok) {
      wait(ctx.from.id, { type: 'ask', orderId: o.id });
      return ctx.reply('Напишите, что поправить (цвет, размер, упаковку…) — флорист переделает и пришлёт новое фото 💐');
    }
  });

  bot.on('photo', async (ctx) => {
    if (!isOwner(ctx.from.id)) { // фото от покупателя (например, пример желаемого букета) — флористу
      const w = takeWaiting(ctx.from.id); waiting.delete(String(ctx.from.id));
      return fromBuyer(ctx, { photo: ctx.message.photo.at(-1).file_id, text: ctx.message.caption || null, orderId: w?.orderId });
    }
    const fileId = ctx.message.photo.at(-1).file_id; // самое большое разрешение
    const w = takeWaiting(ctx.from.id);
    // Номер заказа можно указать и в подписи: «12», «№12» или «#12»
    const cap = ctx.message.caption || '';
    const fromCaption = cap.match(/^\s*(?:№|#)?\s*(\d+)\s*$/) || cap.match(/(?:№|#)\s*(\d+)/); // «12», «№12», «#12» — но не «на 8 марта»
    const orderId = w?.type === 'photo' ? w.orderId : fromCaption ? Number(fromCaption[1]) : null;
    if (!orderId) return ctx.reply('Чтобы отправить фото покупателю, подпишите его номером заказа, например «12» или «№12» 📸');
    waiting.delete(String(ctx.from.id));
    try {
      await sendBouquetPhoto(orderId, fileId);
      ctx.reply(`Фото отправлено на согласование (заказ №${orderId}) ✅\nКак только покупатель ответит — напишу`);
    } catch (e) { ctx.reply('Не получилось отправить: ' + e.message); }
  });

  // ─── Отзывы ⭐ после доставки ───────────────────────────
  const stars = (n) => '⭐'.repeat(n);
  async function askReview(o) {
    db.markReviewAsked(o.id);
    await bot.telegram.sendMessage(o.user_id, `Как вам букет по заказу №${o.id}? 🌷\nОцените, пожалуйста — это очень помогает нам`, {
      ...Markup.inlineKeyboard([[1, 2, 3, 4, 5].map((n) => Markup.button.callback(`${n} ⭐`, `rate:${o.id}:${n}`))]),
    }).catch((e) => console.error('Отзыв:', e.message));
  }
  bot.action(/^rate:(\d+):([1-5])$/, async (ctx) => {
    const o = ownOrder(ctx, ctx.match[1]);
    if (!o) return ctx.answerCbQuery('Заказ не найден');
    const n = Number(ctx.match[2]);
    db.setRating(o.id, n);
    await ctx.answerCbQuery('Спасибо!');
    await ctx.editMessageText(`Ваша оценка заказа №${o.id}: ${stars(n)}`).catch(() => {});
    if (OWNER_ID) {
      bot.telegram.sendMessage(OWNER_ID, `${stars(n)} Оценка к заказу №${o.id} от ${esc(o.customer_name)}`, { parse_mode: 'HTML' }).catch(() => {});
    }
    if (n <= 3) {
      wait(ctx.from.id, { type: 'review', orderId: o.id });
      return ctx.reply('Нам очень жаль 😔 Расскажите, что пошло не так — флорист обязательно прочитает');
    }
    return ctx.reply('Спасибо! Будем рады порадовать вас снова 💐', Markup.inlineKeyboard([
      [Markup.button.webApp('🔁 Повторить заказ', shopUrl({ repeat: o.id }))],
    ]));
  });

  // ─── Напоминания о поводе через год ────────────────────
  bot.action(/^rem:(\d+)$/, async (ctx) => {
    const o = ownOrder(ctx, ctx.match[1]);
    if (!o) return ctx.answerCbQuery('Заказ не найден');
    await ctx.answerCbQuery();
    const r = db.getReminderByOrder(o.id);
    if (r) return ctx.reply(`Уже напомню ${fmt(r.remind_at)} — за 3 дня до повода 🔔`);
    return ctx.reply('Какой был повод? 🎁', Markup.inlineKeyboard([
      Object.entries(OCCASIONS).map(([k, t]) => Markup.button.callback(t, `rem:${o.id}:${k}`)),
    ]));
  });
  bot.action(/^rem:(\d+):(bd|an|ot)$/, async (ctx) => {
    const o = ownOrder(ctx, ctx.match[1]);
    if (!o) return ctx.answerCbQuery('Заказ не найден');
    if (db.getReminderByOrder(o.id)) return ctx.answerCbQuery('Напоминание уже есть');
    const event = new Date(o.delivery_date + 'T12:00:00Z');
    event.setUTCFullYear(event.getUTCFullYear() + 1);
    const remind = new Date(event - 3 * 864e5);
    const iso = (d) => d.toISOString().slice(0, 10);
    db.addReminder({ user_id: o.user_id, order_id: o.id, occasion: OCCASIONS[ctx.match[2]], event_date: iso(event), remind_at: iso(remind) });
    await ctx.answerCbQuery('Сохранено 🔔');
    await ctx.editMessageText(`Готово! ${OCCASIONS[ctx.match[2]]} — ${fmt(iso(event))}.\nНапомню ${fmt(iso(remind))}, за 3 дня 🔔`).catch(() => {});
  });

  bot.command('reminders', async (ctx) => {
    const list = db.getUserReminders(ctx.from.id);
    if (!list.length) return ctx.reply('Напоминаний пока нет. Их можно включить кнопкой «🔔 Напомнить» после заказа');
    for (const r of list) {
      await ctx.reply(`${r.occasion} — ${fmt(r.event_date)}\nНапомню ${fmt(r.remind_at)} (заказ №${r.order_id})`,
        Markup.inlineKeyboard([Markup.button.callback('❌ Удалить', `remdel:${r.id}`)]));
    }
  });
  bot.action(/^remdel:(\d+)$/, async (ctx) => {
    db.deleteReminder(Number(ctx.match[1]), ctx.from.id);
    await ctx.answerCbQuery('Удалено');
    await ctx.editMessageText('Напоминание удалено 🗑').catch(() => {});
  });

  // ─── Сводка для владелицы: что везём сегодня ───────────
  const mskDate = (plusDays = 0) => new Date(Date.now() + 3 * 3600e3 + plusDays * 864e5).toISOString().slice(0, 10);
  function summaryText(date, title) {
    const list = db.getOrdersForDate(date);
    const lines = [`${title} — ${fmt(date)}`, ''];
    if (!list.length) lines.push('Доставок нет 🌿');
    for (const o of list) {
      lines.push(`<b>${o.delivery_time}</b> · №${o.id} ${db.STATUSES[o.status].split(' ')[0]}`);
      lines.push(`   ${o.items.map((i) => `${esc(i.name)} ×${i.qty}`).join(', ')}`);
      lines.push(`   📍 ${esc(o.address)}${o.card_text ? ' · 💌 открытка' : ''}`);
    }
    if (list.length) {
      const sum = list.reduce((s, o) => s + o.total, 0);
      lines.push('', `Итого: ${list.length} ${list.length === 1 ? 'доставка' : list.length < 5 ? 'доставки' : 'доставок'} на ${sum.toLocaleString('ru-RU')} ₽`);
    }
    const unread = db.unreadTotal();
    if (unread) lines.push(`💬 Непрочитанных сообщений: ${unread}`);
    const low = db.getLowStock();
    if (low.length) lines.push('', '⚠️ Заканчивается:', ...low.map((p) => `   ${esc(p.name)} — ${p.stock} шт`));
    return lines.join('\n');
  }
  const summaryKb = () => Markup.inlineKeyboard([Markup.button.webApp('⚙️ Открыть админку', adminUrl())]);
  bot.command('today', (ctx) => isOwner(ctx.from.id)
    ? ctx.reply(summaryText(mskDate(0), '☀️ Сегодня'), { parse_mode: 'HTML', ...summaryKb() }) : ctx.reply('Команда только для владелицы 🌷'));
  bot.command('tomorrow', (ctx) => isOwner(ctx.from.id)
    ? ctx.reply(summaryText(mskDate(1), '🌙 Завтра'), { parse_mode: 'HTML', ...summaryKb() }) : ctx.reply('Команда только для владелицы 🌷'));

  // ─── Текстовые сообщения ───────────────────────────────
  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return ctx.reply('Не знаю такой команды 🤔 Попробуйте /start или /orders');
    const w = takeWaiting(ctx.from.id);
    const from = `${esc(ctx.from.first_name || '')}${ctx.from.username ? ' (@' + esc(ctx.from.username) + ')' : ''}`;

    if (w?.type === 'reply' && isOwner(ctx.from.id)) {
      waiting.delete(String(ctx.from.id));
      try { await toBuyer(w.toUser, text, w.orderId); return ctx.reply('Ответ отправлен ✅'); }
      catch (e) { return ctx.reply('Не получилось отправить: ' + e.message); }
    }
    if (isOwner(ctx.from.id)) {
      return ctx.reply('Чтобы ответить покупателю, нажмите «↩️ Ответить» под его сообщением или откройте вкладку «💬 Чаты» в /admin');
    }
    if (w?.type === 'review') {
      waiting.delete(String(ctx.from.id));
      db.setReviewText(w.orderId, text.slice(0, 1000));
      db.addMessage({ user_id: ctx.from.id, name: nameOf(ctx.from), username: ctx.from.username || null,
                      order_id: w.orderId, direction: 'in', text: `📝 Отзыв: ${text.slice(0, 1000)}` });
      if (OWNER_ID) {
        await bot.telegram.sendMessage(OWNER_ID, `📝 Отзыв к заказу №${w.orderId} от ${from}:\n\n${esc(text.slice(0, 1000))}`,
          { parse_mode: 'HTML', ...Markup.inlineKeyboard([
            Markup.button.callback('↩️ Ответить', `reply:${ctx.from.id}:${w.orderId}`),
            Markup.button.webApp('📬 Открыть чат', adminUrl({ chat: ctx.from.id })),
          ]) });
      }
      return ctx.reply('Спасибо, что рассказали 🙏 Флорист свяжется с вами');
    }

    // Любой текст покупателя — сообщение флористу (кнопку искать не нужно)
    waiting.delete(String(ctx.from.id));
    return fromBuyer(ctx, { text: text.slice(0, 3000), orderId: w?.type === 'ask' ? w.orderId : null });
  });

  // ─── Фоновые задачи: отзывы и напоминания ──────────────
  // Фото без ответа: на половине срока — напоминание, по истечении — считаем одобренным
  async function photoTimeouts() {
    const timeout = db.getSetting('photo_timeout', 30); // минут; 0 — ждать сколько угодно
    if (!timeout) return;
    for (const o of db.getPhotoPending()) {
      if (o.waited_min >= timeout) {
        db.setPhotoStatus(o.id, 'auto');
        db.addMessage({ user_id: o.user_id, order_id: o.id, direction: 'out', text: '⏰ Ответа не было — отправляем букет как на фото', is_read: 1 });
        await bot.telegram.sendMessage(o.user_id,
          `⏰ Мы не дождались ответа по фото букета (заказ №${o.id}) — отправляем его как на фото 🌷\nЕсли что-то не так, просто напишите сюда.`).catch(() => {});
        if (OWNER_ID) {
          await bot.telegram.sendMessage(OWNER_ID,
            `⏰ <b>Покупатель не ответил ${timeout} мин</b> · заказ №${o.id}\nСчитаем букет одобренным — можно отправлять курьера`,
            { parse_mode: 'HTML', ...Markup.inlineKeyboard([Markup.button.callback('🚚 В доставку', `st:${o.id}:delivering`)]) }).catch(() => {});
        }
      } else if (!o.photo_reminded && o.waited_min >= timeout / 2) {
        db.markPhotoReminded(o.id);
        const left = Math.max(1, Math.round(timeout - o.waited_min));
        await bot.telegram.sendMessage(o.user_id,
          `🌷 Ждём ваш ответ по фото букета (заказ №${o.id}) ☝️\nЕсли не ответите за ${left} мин — отправим букет как на фото.`,
          Markup.inlineKeyboard([
            Markup.button.callback('👍 Всё отлично!', `ph:ok:${o.id}`),
            Markup.button.callback('✏️ Хочу изменить', `ph:no:${o.id}`),
          ])).catch(() => {});
      }
    }
  }

  async function tick() {
    try {
      for (const o of db.getOrdersForReview(REVIEW_DELAY_MIN)) await askReview(o);
      await photoTimeouts();

      const moscowHour = (new Date().getUTCHours() + 3) % 24;
      // Утренняя сводка в 9:00 по Москве — один раз в день
      if (OWNER_ID && moscowHour >= 9 && db.getSetting('summary_sent', '') !== mskDate()) {
        db.setSetting('summary_sent', mskDate());
        await bot.telegram.sendMessage(OWNER_ID, summaryText(mskDate(), '☀️ Доброе утро! Сегодня'), { parse_mode: 'HTML', ...summaryKb() })
          .catch((e) => console.error('Сводка:', e.message));
      }
      if (moscowHour >= 10 && moscowHour < 21) { // напоминаем днём, а не ночью
        for (const r of db.getDueReminders()) {
          const o = db.getOrder(r.order_id);
          db.bumpReminder(r.id); // повод ежегодный — следующий раз через год
          if (!o) continue;
          const what = o.items.map((i) => i.name).join(', ');
          await bot.telegram.sendMessage(r.user_id,
            `🔔 Через 3 дня — ${r.occasion.toLowerCase()} (${fmt(r.event_date)})${o.recipient ? `, ${esc(o.recipient)}` : ''}!\n` +
            `В прошлый раз вы дарили: ${esc(what)}.\nПовторим или выберем что-то новое? 💐`,
            { parse_mode: 'HTML', ...Markup.inlineKeyboard([
              [Markup.button.webApp('🔁 Повторить тот же букет', shopUrl({ repeat: o.id }))],
              [Markup.button.webApp('💐 Выбрать другой', shopUrl())],
            ]) }).catch((e) => console.error('Напоминание:', e.message));
        }
      }
    } catch (e) {
      console.error('Фоновая задача:', e.message);
    }
  }
  setInterval(tick, 60_000).unref(); // раз в минуту
  setTimeout(tick, 10_000).unref();

  return { buyerKeyboard, orderKeyboard, shopUrl, tick, toBuyer, sendBouquetPhoto };
};
