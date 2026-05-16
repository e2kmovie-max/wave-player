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
  "common.error_generic": {
    ru: "Что-то пошло не так. Попробуй ещё раз.",
    en: "Something went wrong. Try again.",
  },
  "common.not_admin": {
    ru: "Эта команда только для администраторов.",
    en: "This command is for admins only.",
  },

  "start.greeting_title": {
    ru: "<b>Wave</b> — смотрим видео вместе.",
    en: "<b>Wave</b> — watch videos together.",
  },
  "start.greeting_body": {
    ru: "Пришли мне ссылку на YouTube — соберу комнату для совместного просмотра.",
    en: "Send me a YouTube link and I'll spin up a watch-room for you and your friends.",
  },
  "start.admin_hint": {
    ru: "Ты администратор. /admin откроет панель управления.",
    en: "You're an admin. /admin opens the control panel.",
  },
  "start.payload_no_room": {
    ru: "Ты пришёл с приглашением, но комнаты для него уже нет.",
    en: "You arrived with an invite, but the room for it is no longer active.",
  },
  "start.room_ready": {
    ru: "Комната готова:",
    en: "Room is ready:",
  },
  "start.open_room_btn": {
    ru: "Открыть комнату",
    en: "Open room",
  },

  "room.send_video_url": {
    ru: "Пришли мне ссылку на видео (например, с YouTube), и я создам комнату.",
    en: "Send me a video URL (YouTube etc.) and I'll start a watch room.",
  },
  "room.identify_failed": {
    ru: "Не удалось определить твою учётку Wave. Нажми /start и попробуй снова.",
    en: "I could not identify your Wave account. Press /start and try again.",
  },
  "room.preparing": {
    ru: "Готовлю комнату для просмотра…",
    en: "Preparing your watch room…",
  },
  "room.create_failed": {
    ru: "Не получилось создать комнату для этой ссылки. Попробуй позже.",
    en: "Could not create a room for this URL. Try again later.",
  },
  "room.ready_open": {
    ru: "Комната готова.\n\nОткрыть: {webUrl}\nПригласить: {invite}",
    en: "Room is ready.\n\nOpen: {webUrl}\nInvite: {invite}",
  },

  "op.title": {
    ru: "Подпишись на каналы, чтобы продолжить",
    en: "Subscribe to continue",
  },
  "op.continue_btn": {
    ru: "✅ Я подписался — продолжить",
    en: "✅ I subscribed — continue",
  },
  "op.still_missing": {
    ru: "Не все подписки оформлены. Подпишись и нажми «продолжить» ещё раз.",
    en: "Some subscriptions are still missing. Subscribe and press “continue” again.",
  },
  "op.passed": {
    ru: "Готово, ты подписан.",
    en: "Great — you're subscribed.",
  },
  "op.no_pending": {
    ru: "Нет отложенных действий после проверки подписки.",
    en: "No pending action after the subscription check.",
  },

  "admin.menu_title": {
    ru: "Панель администратора Wave",
    en: "Wave admin panel",
  },
  "admin.menu_channels": {
    ru: "📢 Обязательные каналы",
    en: "📢 Required channels",
  },
  "admin.menu_cookies": {
    ru: "🍪 Пул Google-куки",
    en: "🍪 Google cookie pool",
  },
  "admin.menu_instances": {
    ru: "🎬 Инстансы",
    en: "🎬 Streaming instances",
  },
  "admin.menu_close": {
    ru: "Закрыть",
    en: "Close",
  },

  "admin.channels.title": {
    ru: "Обязательные каналы для просмотра.",
    en: "Required channels for watch rooms.",
  },
  "admin.channels.empty": {
    ru: "Список пуст. Добавь первый канал.",
    en: "No channels yet. Add the first one.",
  },
  "admin.channels.add_prompt": {
    ru:
      "Перешли мне сообщение из канала ИЛИ пришли публичный username (например @wave_news) или числовой chat_id (-100…).",
    en:
      "Forward me a message from the channel OR send a public username (e.g. @wave_news) or a numeric chat_id (-100…).",
  },
  "admin.channels.add_btn": { ru: "➕ Добавить канал", en: "➕ Add channel" },
  "admin.channels.invalid": {
    ru:
      "Не распознал канал. Перешли сообщение из канала или пришли @username / -100…",
    en:
      "Could not parse that channel. Forward a message from the channel or send @username / -100…",
  },
  "admin.channels.duplicate": {
    ru: "Этот канал уже в списке.",
    en: "That channel is already in the list.",
  },

  "admin.cookies.title": {
    ru: "Пул Google-куки для yt-dlp. Активные ротируются автоматически по LRU.",
    en: "Google cookie pool for yt-dlp. Active records rotate LRU.",
  },
  "admin.cookies.empty": {
    ru: "Куки не загружены. Без них YouTube будет работать только в ограниченном режиме.",
    en: "No cookies uploaded. YouTube downloads will be limited without them.",
  },
  "admin.cookies.add_btn": { ru: "➕ Добавить куки", en: "➕ Add cookies" },
  "admin.cookies.label_prompt": {
    ru: "Пришли подпись (label) для этой записи — например, email или короткое имя.",
    en: "Send a label for this record — e.g. an email or a short name.",
  },
  "admin.cookies.cookies_prompt": {
    ru:
      "Теперь пришли сам файл cookies.txt (Netscape) или JSON-массив с куками. " +
      "Файл можно как текстом, так и .txt вложением.",
    en:
      "Now send the cookies.txt content (Netscape) or a JSON array of cookies. " +
      "Plain text or a .txt attachment both work.",
  },
  "admin.cookies.invalid_payload": {
    ru: "Не получилось разобрать куки: {error}",
    en: "Could not parse the cookies: {error}",
  },

  "admin.instances.title": {
    ru: "Streaming-инстансы.",
    en: "Streaming instances.",
  },
  "admin.instances.empty": {
    ru: "Инстансов нет. Добавь первый через бота или укажи в INSTANCES_JSON.",
    en: "No instances. Add the first via the bot or list it in INSTANCES_JSON.",
  },
  "admin.instances.add_btn": { ru: "➕ Добавить инстанс", en: "➕ Add instance" },
  "admin.instances.name_prompt": {
    ru: "Короткое имя инстанса (видно только в админке):",
    en: "Short instance name (admin-visible only):",
  },
  "admin.instances.url_prompt": {
    ru:
      "Базовый URL: http(s)://host[:port]. http:// допустим — он вызывается только мастером.",
    en:
      "Base URL: http(s)://host[:port]. http:// is allowed — it's only called by the master node.",
  },
  "admin.instances.url_invalid": {
    ru: "URL должен начинаться с http:// или https://",
    en: "URL must start with http:// or https://",
  },
  "admin.instances.secret_prompt": {
    ru: "HMAC-секрет инстанса (значение INSTANCE_SECRET на сервере):",
    en: "Instance HMAC secret (the server's INSTANCE_SECRET):",
  },
  "admin.instances.duplicate": {
    ru: "Инстанс с таким URL уже существует.",
    en: "An instance with that URL already exists.",
  },

  // ---------------------------------------------------------------------
  // Web app strings. Keep keys prefixed with `web.` so it's obvious from a
  // call site whether a string is rendered in the bot or in the browser.
  // ---------------------------------------------------------------------
  "web.brand": { ru: "Wave", en: "Wave" },
  "web.nav.sign_in": { ru: "Войти", en: "Sign in" },
  "web.nav.sign_out": { ru: "Выйти", en: "Sign out" },
  "web.nav.account": { ru: "Аккаунт", en: "Account" },
  "web.nav.admin": { ru: "Админка", en: "Admin" },
  "web.nav.language": { ru: "Язык", en: "Language" },

  "web.home.title": {
    ru: "Смотрим видеоролики вместе,",
    en: "Watch videos together,",
  },
  "web.home.title_emph": {
    ru: "в идеальной синхронизации.",
    en: "in perfect sync.",
  },
  "web.home.lead": {
    ru: "Пришли ссылку на YouTube (или другой источник из поддерживаемых yt-dlp) и пригласи друзей в общую комнату. Wave синхронизирует play/pause/seek и качество по WebSocket.",
    en: "Drop in a YouTube link (or any source yt-dlp supports) and invite friends to one shared room. Wave keeps play, pause, seek, and quality in sync over WebSocket.",
  },
  "web.home.cta_sign_in": {
    ru: "Войдите, чтобы создать комнату",
    en: "Sign in to create a room",
  },
  "web.home.form_label": {
    ru: "Вставьте ссылку на YouTube или другое видео",
    en: "Paste YouTube / video URL",
  },
  "web.home.form_submit": { ru: "Создать комнату", en: "Create room" },
  "web.home.form_invalid": {
    ru: "Введите корректный http(s) URL видео.",
    en: "Enter a valid http(s) video URL.",
  },
  "web.home.creating": { ru: "Создаём…", en: "Creating room…" },

  "web.login.title": { ru: "Войдите в Wave", en: "Sign in to Wave" },
  "web.login.lead": {
    ru: "Выберите способ. Оба можно связать в одну учётную запись позже из раздела «Аккаунт».",
    en: "Pick a method. You can link the two later from the Account page.",
  },
  "web.login.google": { ru: "Войти через Google", en: "Continue with Google" },
  "web.login.guest": { ru: "Войти как гость", en: "Continue as guest" },
  "web.login.guest_label": { ru: "Гостевой вход", en: "Guest sign-in" },
  "web.login.guest_placeholder": { ru: "Имя в чате", en: "Chat name" },
  "web.login.telegram": { ru: "Открыть Telegram Mini App", en: "Open Telegram Mini App" },
  "web.login.error_google_unconfigured": {
    ru: "Google OAuth не настроен. Обратитесь к админу.",
    en: "Google sign-in isn't configured yet — ask the admin.",
  },
  "web.login.error_bot_unconfigured": {
    ru: "Бот ещё не подключён. Попробуйте Google.",
    en: "The bot isn't configured yet — try Google.",
  },

  "web.account.title": { ru: "Аккаунт", en: "Account" },
  "web.account.linked_google": { ru: "Привязан Google", en: "Linked Google" },
  "web.account.linked_telegram": { ru: "Привязан Telegram", en: "Linked Telegram" },
  "web.account.not_linked": { ru: "не привязан", en: "not linked" },
  "web.account.link_google": { ru: "Привязать Google", en: "Link Google" },
  "web.account.link_telegram": { ru: "Привязать Telegram", en: "Link Telegram" },
  "web.account.unlink": { ru: "Отвязать", en: "Unlink" },

  "web.room.title": { ru: "Комната", en: "Room" },
  "web.room.share_hint": {
    ru: "Поделитесь ссылкой, чтобы друзья присоединились.",
    en: "Share this URL to invite friends.",
  },
  "web.room.quality": { ru: "Качество", en: "Quality" },
  "web.room.state_sync": { ru: "Синхронизация", en: "State sync" },
  "web.room.duration": { ru: "Длительность", en: "Duration" },
  "web.room.copy_link": { ru: "Скопировать ссылку", en: "Copy link" },
  "web.room.link_copied": { ru: "Ссылка скопирована", en: "Link copied" },

  "web.admin.title": { ru: "Админ-панель", en: "Admin panel" },
  "web.admin.cookies": { ru: "Пул Google-кук", en: "Google cookie pool" },
  "web.admin.instances": { ru: "Инстансы", en: "Instances" },
  "web.admin.channels": { ru: "Обязательные каналы", en: "Required channels" },
  "web.admin.health": { ru: "Здоровье", en: "Health" },
  "web.admin.rotation_count": { ru: "Ротаций", en: "Rotations" },
  "web.admin.auto_disabled": { ru: "авто-откл.", en: "auto-disabled" },
  "web.admin.consecutive_failures": {
    ru: "Подряд фейлов",
    en: "Consecutive failures",
  },
  "web.admin.tools_version": { ru: "Версии yt-dlp / ffmpeg", en: "yt-dlp / ffmpeg" },
  "web.admin.active_streams": { ru: "Активных стримов", en: "Active streams" },
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
