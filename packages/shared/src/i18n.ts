/**
 * Tiny RU/EN translation helper shared between the bot and the web app.
 *
 * Stage 4 introduced RU+EN bot strings selected by Telegram `language_code`
 * (`ru*` → RU, anything else → EN). Stage 5 expands the table with `web.*`
 * strings and adds `pickWebLang()` so the Next.js server components can
 * detect a preferred language from a `wave_lang` cookie or `Accept-Language`.
 *
 * Strings are stored as a flat record so adding a new key is a one-liner the
 * TypeScript compiler immediately enforces on every `t()` call site.
 */

export type Lang = "ru" | "en";

const strings = {
  "common.back": { ru: "← Назад", en: "← Back" },
  "common.cancel": { ru: "Отмена", en: "Cancel" },
  "common.added": { ru: "Добавлено.", en: "Added." },
  "common.removed": { ru: "Удалено.", en: "Removed." },
  "common.disabled": { ru: "Отключено.", en: "Disabled." },
  "common.enabled": { ru: "Включено.", en: "Enabled." },
  "common.error_generic": { ru: "Что-то пошло не так. Попробуй ещё раз.", en: "Something went wrong. Try again." },
  "common.not_admin": { ru: "Эта команда только для администраторов.", en: "This command is for admins only." },
  "start.greeting_title": { ru: "<b>Wave</b> — смотрим видео вместе.", en: "<b>Wave</b> — watch videos together." },
  "start.greeting_body": { ru: "Пришли мне ссылку на видео — соберу комнату для совместного просмотра.", en: "Send me a video link and I'll spin up a watch-room for you and your friends." },
  "start.admin_hint": { ru: "Ты администратор. /admin откроет панель управления.", en: "You're an admin. /admin opens the control panel." },
  "start.payload_no_room": { ru: "Ты пришёл с приглашением, но комнаты для него уже нет.", en: "You arrived with an invite, but the room for it is no longer active." },
  "start.room_ready": { ru: "Комната готова:", en: "Room is ready:" },
  "start.open_room_btn": { ru: "Открыть комнату", en: "Open room" },
  "room.send_video_url": { ru: "Пришли мне ссылку на видео, и я создам комнату для совместного просмотра.", en: "Send me a video link and I'll spin up a watch room." },
  "room.identify_failed": { ru: "Не удалось определить твою учётку Wave. Нажми /start и попробуй снова.", en: "I could not identify your Wave account. Press /start and try again." },
  "room.preparing": { ru: "Готовлю комнату для просмотра…", en: "Preparing your watch room…" },
  "room.create_failed": { ru: "Не получилось создать комнату для этой ссылки. Попробуй позже.", en: "Could not create a room for this URL. Try again later." },
  "room.ready_open": { ru: "Комната готова.\n\nОткрыть: {webUrl}\nПригласить: {invite}", en: "Room is ready.\n\nOpen: {webUrl}\nInvite: {invite}" },
  "op.title": { ru: "Подпишись на каналы, чтобы продолжить", en: "Subscribe to continue" },
  "op.continue_btn": { ru: "✅ Я подписался — продолжить", en: "✅ I subscribed — continue" },
  "op.still_missing": { ru: "Не все подписки оформлены. Подпишись и нажми «продолжить» ещё раз.", en: "Some subscriptions are still missing. Subscribe and press “continue” again." },
  "op.passed": { ru: "Готово, ты подписан.", en: "Great — you're subscribed." },
  "op.no_pending": { ru: "Нет отложенных действий после проверки подписки.", en: "No pending action after the subscription check." },
  "admin.menu_title": { ru: "Панель администратора Wave", en: "Wave admin panel" },
  "admin.menu_channels": { ru: "📢 Обязательные каналы", en: "📢 Required channels" },
  "admin.menu_cookies": { ru: "🍪 Пул Google-куки", en: "🍪 Google cookie pool" },
  "admin.menu_instances": { ru: "🎬 Инстансы", en: "🎬 Streaming instances" },
  "admin.menu_close": { ru: "Закрыть", en: "Close" },
  "admin.channels.title": { ru: "Обязательные каналы для просмотра.", en: "Required channels for watch rooms." },
  "admin.channels.empty": { ru: "Список пуст. Добавь первый канал.", en: "No channels yet. Add the first one." },
  "admin.channels.add_prompt": { ru: "Перешли мне сообщение из канала ИЛИ пришли публичный username (например @wave_news) или числовой chat_id (-100…).", en: "Forward me a message from the channel OR send a public username (e.g. @wave_news) or a numeric chat_id (-100…)." },
  "admin.channels.add_btn": { ru: "➕ Добавить канал", en: "➕ Add channel" },
  "admin.channels.invalid": { ru: "Не распознал канал. Перешли сообщение из канала или пришли @username / -100…", en: "Could not parse that channel. Forward a message from the channel or send @username / -100…" },
  "admin.channels.duplicate": { ru: "Этот канал уже в списке.", en: "That channel is already in the list." },
  "admin.cookies.title": { ru: "Пул Google-куки для yt-dlp. Активные ротируются автоматически по LRU.", en: "Google cookie pool for yt-dlp. Active records rotate LRU." },
  "admin.cookies.empty": { ru: "Куки не загружены. Без них YouTube будет работать только в ограниченном режиме.", en: "No cookies uploaded. YouTube downloads will be limited without them." },
  "admin.cookies.add_btn": { ru: "➕ Добавить куки", en: "➕ Add cookies" },
  "admin.cookies.label_prompt": { ru: "Пришли подпись (label) для этой записи — например, email или короткое имя.", en: "Send a label for this record — e.g. an email or a short name." },
  "admin.cookies.cookies_prompt": { ru: "Теперь пришли сам файл cookies.txt (Netscape) или JSON-массив с куками. Файл можно как текстом, так и .txt вложением.", en: "Now send the cookies.txt content (Netscape) or a JSON array of cookies. Plain text or a .txt attachment both work." },
  "admin.cookies.invalid_payload": { ru: "Не получилось разобрать куки: {error}", en: "Could not parse the cookies: {error}" },
  "admin.instances.title": { ru: "Streaming-инстансы.", en: "Streaming instances." },
  "admin.instances.empty": { ru: "Инстансов нет. Добавь первый через бота или укажи в INSTANCES_JSON.", en: "No instances. Add the first via the bot or list it in INSTANCES_JSON." },
  "admin.instances.add_btn": { ru: "➕ Добавить инстанс", en: "➕ Add instance" },
  "admin.instances.name_prompt": { ru: "Короткое имя инстанса (видно только в админке):", en: "Short instance name (admin-visible only):" },
  "admin.instances.url_prompt": { ru: "Базовый URL: http(s)://host[:port]. http:// допустим — он вызывается только мастером.", en: "Base URL: http(s)://host[:port]. http:// is allowed — it's only called by the master node." },
  "admin.instances.url_invalid": { ru: "URL должен начинаться с http:// или https://", en: "URL must start with http:// or https://" },
  "admin.instances.secret_prompt": { ru: "HMAC-секрет инстанса (значение INSTANCE_SECRET на сервере):", en: "Instance HMAC secret (the server's INSTANCE_SECRET):" },
  "admin.instances.duplicate": { ru: "Инстанс с таким URL уже существует.", en: "An instance with that URL already exists." },
  "web.brand": { ru: "Wave", en: "Wave" },
  "web.nav.sign_in": { ru: "Войти", en: "Sign in" },
  "web.nav.sign_out": { ru: "Выйти", en: "Sign out" },
  "web.nav.language": { ru: "Язык", en: "Language" },
  "web.home.title": { ru: "Смотрим вместе,", en: "Watch together," },
  "web.home.title_emph": { ru: "кадр в кадр.", en: "in lockstep." },
  "web.home.lead": { ru: "Вставь ссылку на видео и пригласи друзей в общую комнату. Wave держит play, pause, seek и качество синхронно у всех зрителей.", en: "Drop a video link and invite friends to one shared room. Wave keeps play, pause, seek and quality aligned across everyone watching." },
  "web.home.cta_sign_in": { ru: "Войти и создать комнату", en: "Sign in to create a room" },
  "web.home.form_label": { ru: "Вставь ссылку на видео", en: "Paste a video link" },
  "web.home.form_submit": { ru: "Создать комнату", en: "Create room" },
  "web.home.form_invalid": { ru: "Введи корректный http(s) URL видео.", en: "Enter a valid http(s) video URL." },
  "web.home.creating": { ru: "Создаём…", en: "Spinning up…" },
  "web.login.title": { ru: "Войти в Wave", en: "Sign in to Wave" },
  "web.login.lead": { ru: "Выбери способ. Позже можно связать обе учётки в одну.", en: "Pick a method. You can link both identities into one account later." },
  "web.login.google": { ru: "Через Google", en: "Continue with Google" },
  "web.login.guest": { ru: "Войти как гость", en: "Continue as guest" },
  "web.login.guest_label": { ru: "Гостевой вход", en: "Guest sign-in" },
  "web.login.guest_placeholder": { ru: "Имя в чате", en: "Chat display name" },
  "web.login.telegram": { ru: "Открыть в Telegram", en: "Open in Telegram" },
  "web.login.error_google_unconfigured": { ru: "Google OAuth не настроен.", en: "Google sign-in isn't configured yet." },
  "web.login.error_bot_unconfigured": { ru: "Бот ещё не подключён.", en: "The bot isn't configured yet." },
  "web.login.miniapp_hint": { ru: "Уже в Telegram? Открой Mini App — войдём автоматически.", en: "Already inside the bot? Open the Mini App and we'll sign you in." },
  "web.account.title": { ru: "Связанные аккаунты", en: "Linked identities" },
  "web.account.lead": { ru: "Подключи Google и Telegram к одной учётке Wave, чтобы открывать комнаты с любого устройства.", en: "Attach Google and Telegram to a single Wave account so rooms follow you across devices." },
  "web.account.linked": { ru: "Подключено", en: "Linked" },
  "web.account.not_linked": { ru: "Не подключено", en: "Not linked" },
  "web.account.link_google": { ru: "Привязать Google", en: "Link Google" },
  "web.account.link_telegram": { ru: "Привязать Telegram", en: "Link Telegram" },
  "web.account.guest_notice": { ru: "Сейчас ты в гостевом режиме. Привяжи Google, чтобы сохранить аккаунт.", en: "You're in guest mode. Link Google to keep this account." },
  "web.room.title": { ru: "Комната", en: "Room" },
  "web.room.share_hint": { ru: "Отправь ссылку, чтобы друзья присоединились.", en: "Share this link to invite friends." },
  "web.room.quality": { ru: "Качество", en: "Quality" },
  "web.room.speed": { ru: "Скорость", en: "Speed" },
  "web.room.state_sync": { ru: "Синхронизация", en: "Sync" },
  "web.room.duration": { ru: "Длительность", en: "Duration" },
  "web.room.copy_link": { ru: "Скопировать ссылку", en: "Copy link" },
  "web.room.link_copied": { ru: "Скопировано", en: "Copied" },
  "web.room.chat_title": { ru: "Чат", en: "Chat" },
  "web.room.chat_empty": { ru: "Пока пусто. Поздоровайся первым.", en: "No messages yet. Say hi." },
  "web.room.chat_placeholder": { ru: "Сообщение или эмодзи", en: "Message or emoji" },
  "web.room.chat_send": { ru: "Отправить", en: "Send" },
  "web.room.connected": { ru: "На связи", en: "Connected" },
  "web.room.reconnecting": { ru: "Переподключаемся", en: "Reconnecting" },
  "web.room.playing": { ru: "Играет", en: "Playing" },
  "web.room.paused": { ru: "Пауза", en: "Paused" },
  "web.room.invite": { ru: "Пригласить", en: "Invite" },
  "web.room.web_invite": { ru: "Через сайт", en: "Web invite" },
  "web.room.telegram_invite": { ru: "Через Telegram", en: "Telegram invite" },
  "web.miniapp.heading": { ru: "Привет 👋", en: "Welcome 👋" },
  "web.miniapp.lead": { ru: "Wave подтверждает твой Telegram-аккаунт и связывает его с веб-сессией.", en: "Wave verifies your Telegram identity and links it to a web session." },
  "web.miniapp.idle": { ru: "Ждём данные из Telegram… Если это открыто вне Telegram, ничего не произойдёт.", en: "Waiting for the Telegram WebApp environment. Outside Telegram this stays idle." },
  "web.miniapp.verifying": { ru: "Проверяем подпись…", en: "Verifying signature…" },
  "web.miniapp.ready": { ru: "Готово. Возвращайся в бота — сессия активна.", en: "You're in. Head back to the bot — your session is active." },
  "web.miniapp.link_hint": { ru: "Связать этот Telegram с моим Google-аккаунтом", en: "Link this Telegram identity to my Google account" },
  "web.miniapp.retry": { ru: "Повторить", en: "Retry" },
  "web.tgauth.title": { ru: "Привязка Telegram к Google", en: "Link Telegram with Google" },
  "web.tgauth.greeting": { ru: "Привет, {name}! Войди через Google — и мы свяжем этот Telegram-аккаунт с твоим профилем Wave.", en: "Hi {name}! Sign in with Google and we'll link this Telegram identity to your Wave profile." },
  "web.tgauth.continue": { ru: "Продолжить через Google", en: "Continue with Google" },
  "web.tgauth.security_note": { ru: "Ссылка одноразовая, подписана сервером и действует 10 минут. Если истекла — открой /link в боте ещё раз.", en: "The link is single-use, server-signed and valid for 10 minutes. If it expired, run /link in the bot again." },
  "web.tgauth.done_title": { ru: "Готово — аккаунты связаны", en: "Done — accounts are linked" },
  "web.tgauth.done_body": { ru: "Google и Telegram теперь указывают на одну учётку Wave. Можешь вернуться в бота — он подтвердит связку отдельным сообщением.", en: "Google and Telegram now point to the same Wave account. You can return to the bot — it'll confirm the link in a separate message." },
  "web.tgauth.back_to_bot": { ru: "Вернуться в бота", en: "Back to the bot" },
  "web.tgauth.open_account": { ru: "Открыть «Аккаунт»", en: "Open “Account”" },
  "web.tgauth.error_title": { ru: "Не получилось привязать аккаунт", en: "Couldn't link the account" },
  "web.tgauth.error_invalid": { ru: "Ссылка не подписана или повреждена.", en: "The link is not signed or is corrupted." },
  "web.tgauth.error_expired": { ru: "Ссылка просрочена (живёт 10 минут). Открой /link в боте ещё раз.", en: "The link expired (10-minute lifetime). Run /link in the bot again." },
  "web.tgauth.error_already_linked": { ru: "Этот Google-аккаунт уже привязан к другой учётке Wave.", en: "That Google account is already linked to a different Wave user." },
  "web.tgauth.error_bot_disabled": { ru: "Бот не настроен на сервере, привязка через /link недоступна.", en: "The bot isn't configured on the server, so /link isn't available." },
  "web.tgauth.notify_success": { ru: "✅ Готово. Google-аккаунт <b>{email}</b> теперь связан с твоим Telegram. Можешь создавать комнаты с любого устройства.", en: "✅ Done. Google account <b>{email}</b> is now linked to your Telegram. You can create rooms from any device." },
  "bot.link.intro": { ru: "Открой эту ссылку, войди через Google — и я свяжу этот Telegram-аккаунт с твоим Google-профилем Wave.", en: "Open this link, sign in with Google and I'll link this Telegram identity to your Google profile on Wave." },
  "bot.link.button": { ru: "🔗 Привязать Google", en: "🔗 Link Google" },
  "bot.link.disabled": { ru: "Привязка через Google недоступна: не настроен Google OAuth или PUBLIC_WEB_URL.", en: "Google linking is unavailable: Google OAuth or PUBLIC_WEB_URL is not configured." },
  "web.nav.account": { ru: "Аккаунт", en: "Account" },
  "web.nav.admin": { ru: "Админка", en: "Admin" },
  "web.account.linked_google": { ru: "Привязан Google", en: "Linked Google" },
  "web.account.linked_telegram": { ru: "Привязан Telegram", en: "Linked Telegram" },
  "web.account.unlink": { ru: "Отвязать", en: "Unlink" },
  "web.admin.title": { ru: "Админ-панель", en: "Admin panel" },
  "web.admin.cookies": { ru: "Пул Google-кук", en: "Google cookie pool" },
  "web.admin.instances": { ru: "Инстансы", en: "Instances" },
  "web.admin.channels": { ru: "Обязательные каналы", en: "Required channels" },
  "web.admin.health": { ru: "Здоровье", en: "Health" },
  "web.admin.rotation_count": { ru: "Ротаций", en: "Rotations" },
  "web.admin.auto_disabled": { ru: "авто-откл.", en: "auto-disabled" },
  "web.admin.consecutive_failures": { ru: "Подряд фейлов", en: "Consecutive failures" },
  "web.admin.tools_version": { ru: "Версии yt-dlp / ffmpeg", en: "yt-dlp / ffmpeg" },
  "web.admin.active_streams": { ru: "Активных стримов", en: "Active streams" },
  "web.friends.title": { ru: "Друзья", en: "Friends" },
  "web.friends.empty": { ru: "Пока без друзей. Отправь приглашение из карточки пользователя.", en: "No friends yet. Send an invite from another user's profile." },
  "web.friends.tab_all": { ru: "Все", en: "All" },
  "web.friends.tab_online": { ru: "Онлайн", en: "Online" },
  "web.friends.tab_watching": { ru: "Смотрят сейчас", en: "Watching now" },
  "web.friends.tab_pending": { ru: "Заявки", en: "Requests" },
  "web.friends.status_online": { ru: "Онлайн", en: "Online" },
  "web.friends.status_idle": { ru: "Неактивен", en: "Idle" },
  "web.friends.status_sleeping": { ru: "Спит", en: "Sleeping" },
  "web.friends.status_offline": { ru: "Не в сети", en: "Offline" },
  "web.friends.status_watching": { ru: "Смотрит", en: "Watching" },
  "web.friends.watching_on": { ru: "Смотрит на {service}", en: "Watching on {service}" },
  "web.friends.watching_title_on": { ru: "«{title}» — {service}", en: "“{title}” — {service}" },
  "web.friends.action_accept": { ru: "Принять", en: "Accept" },
  "web.friends.action_decline": { ru: "Отклонить", en: "Decline" },
  "web.friends.action_cancel": { ru: "Отменить", en: "Cancel" },
  "web.friends.action_remove": { ru: "Удалить", en: "Remove" },
  "web.friends.action_block": { ru: "Заблокировать", en: "Block" },
  "web.friends.action_unblock": { ru: "Разблокировать", en: "Unblock" },
  "web.friends.action_request_sent": { ru: "Заявка отправлена", en: "Request sent" },
  "web.friends.action_invite": { ru: "Пригласить в друзья", en: "Add friend" },
  "web.friends.action_join_room": { ru: "Присоединиться", en: "Join room" },
  "web.friends.last_seen_just_now": { ru: "только что", en: "just now" },
  "web.friends.last_seen_minutes": { ru: "{minutes} мин назад", en: "{minutes} min ago" },
  "web.friends.last_seen_hours": { ru: "{hours} ч назад", en: "{hours}h ago" },
  "web.friends.last_seen_days": { ru: "{days} дн назад", en: "{days}d ago" },
  "web.friends.last_seen_long_ago": { ru: "давно не был в сети", en: "offline for a while" },
  "web.friends.manual_online": { ru: "В сети", en: "Available" },
  "web.friends.manual_sleeping": { ru: "Сплю — не беспокоить", en: "Sleeping — do not disturb" },
  "web.friends.manual_offline": { ru: "Невидимка", en: "Appear offline" },
  "web.friends.manual_auto": { ru: "Автоматически", en: "Automatic" },
  "web.notifications.title": { ru: "Уведомления", en: "Notifications" },
  "web.notifications.empty": { ru: "Здесь пусто.", en: "Nothing here yet." },
  "web.notifications.mark_all_read": { ru: "Отметить всё прочитанным", en: "Mark all as read" },
  "web.notifications.friend_request": { ru: "{name} прислал тебе заявку в друзья.", en: "{name} sent you a friend request." },
  "web.notifications.friend_accepted": { ru: "{name} принял твою заявку в друзья.", en: "{name} accepted your friend request." },
  "web.notifications.friend_online": { ru: "{name} в сети.", en: "{name} is online." },
  "web.notifications.friend_watching_with_title": { ru: "{name} смотрит «{title}» на {service}.", en: "{name} is watching “{title}” on {service}." },
  "web.notifications.friend_watching": { ru: "{name} смотрит на {service}.", en: "{name} is watching on {service}." },
} as const satisfies Record<string, { ru: string; en: string }>;

export type I18nKey = keyof typeof strings;

/** Returns `ru` when language_code looks like Russian/Ukrainian/Belarusian, else `en`. */
export function pickLang(languageCode: string | null | undefined): Lang {
  const code = (languageCode ?? "").toLowerCase();
  if (code.startsWith("ru") || code.startsWith("uk") || code.startsWith("be")) {
    return "ru";
  }
  return "en";
}

/**
 * Pick the preferred web language from an explicit override (a `wave_lang`
 * cookie set by the user) plus the browser's `Accept-Language` header.
 *
 *  1. A non-empty explicit override always wins, even if it's something we
 *     don't translate — we just fall back to the default in that case so
 *     adding a new language later doesn't break old cookies.
 *  2. Otherwise we walk the `Accept-Language` header in q-weight order and
 *     return the first language code that maps to a supported `Lang`.
 *  3. Default: English.
 */
export function pickWebLang(opts: {
  cookieValue?: string | null;
  acceptLanguage?: string | null;
} = {}): Lang {
  const override = (opts.cookieValue ?? "").trim().toLowerCase();
  if (override === "ru" || override === "en") return override as Lang;
  if (override !== "") {
    // Unknown override — try mapping it anyway, but don't loop into AL
    return pickLang(override);
  }
  const header = opts.acceptLanguage ?? "";
  for (const entry of parseAcceptLanguage(header)) {
    if (entry.startsWith("ru") || entry.startsWith("uk") || entry.startsWith("be")) {
      return "ru";
    }
    if (entry.startsWith("en")) return "en";
  }
  return "en";
}

/** Supported languages, in the order surfaced by the language switcher UI. */
export const SUPPORTED_WEB_LANGS: ReadonlyArray<{ code: Lang; label: string }> = [
  { code: "en", label: "English" },
  { code: "ru", label: "Русский" },
];

function parseAcceptLanguage(header: string): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => {
      const [tag, ...rest] = part.trim().split(";");
      const q = rest
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="))
        ?.slice(2);
      const weight = q ? Number(q) : 1;
      return { tag: (tag || "").toLowerCase(), weight: Number.isFinite(weight) ? weight : 1 };
    })
    .filter((p) => p.tag !== "")
    .sort((a, b) => b.weight - a.weight)
    .map((p) => p.tag);
}

/** Interpolates `{name}` placeholders into the string. */
export function t(
  lang: Lang,
  key: I18nKey,
  vars?: Record<string, string | number>,
): string {
  const value = strings[key][lang] ?? strings[key].en;
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (_, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : `{${name}}`,
  );
}

export const __i18nTest__ = { strings };
