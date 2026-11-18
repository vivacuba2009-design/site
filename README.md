# Синапс — песочница synaps.bond

Демонстрационная страница турбота для турфирм.

## Структура

| Путь | Что |
|---|---|
| `public/index.html` | главная: hero, демо чата, выгоды, процесс, цены, вопросы |
| `public/style.css` | оформление, тёмная тема, адаптив |
| `public/app.js` | диалог демо: сценарий заявки, маска телефона, карточка, мок менеджера |
| `public/bot-engine.js` | движок: интенты + календарь («новый год», «31.12», «в январе») |
| `public/tours.json` | база демо: 11 вымышленных туров, новогодние даты |
| `public/privacy.html` | политика конфиденциальности |
| `public/404.html` | страница ошибки |
| `src/index.js` | воркер: статика + `POST /api/chat` (ИИ) + `/api/telegram/<hash>` (бот) |
| `src/ai.js` | один ИИ-слой для сайта и бота: модель формулирует, числа проверяются по `tours.json` |
| `src/telegram.js` | Telegram-бот: `/start`, кнопки направлений, туры, заявка в чат владельца |
| `wrangler.jsonc` | Cloudflare Workers: `main` + статика из `public` через ASSETS |

## Правки

Туры — в `public/tours.json`, тексты — в `public/index.html`, интенты — в `public/bot-engine.js`.
После правки: коммит и push, Cloudflare пересоберёт сам.

## ИИ-ответы (`/api/chat`)

Включаются, только когда движок не разобрал вопрос. Ключ живёт в секрете воркера:

- **на проде**: Cloudflare → Workers & Pages → `site` → Settings → Variables and Secrets → Add → Type **Secret**, Name `SYNAPS_DEEPSEEK_KEY`;
- **локально**: строка `SYNAPS_DEEPSEEK_KEY:` в `~/.dsh/.credentials.yaml` (файл вне репозитория);
- в код, `wrangler.jsonc` и `tours.json` ключ не кладём никогда.

Правила ответа: ИИ берёт факты только из `tours.json`; числа в ответе проверяются (цена/даты/длительность должны быть в базе), иначе ответ отбрасывается. При недоступном API демо отвечает обычным движком.

## Telegram-бот

Тот же воркер, вебхук Telegram. Токен — секрет `SYNAPS_TELEGRAM_TOKEN` (в дашборде, как и ключ ИИ).
Адрес вебхука содержит секретный путь: `https://synaps.bond/api/telegram/<первые 16 символов sha256(токен)>`. Без него — 403.
Заявки из бота уходят в чат `SYNAPS_TELEGRAM_CHAT_ID` (если не задан — в чат того, кто писал).
Поставить вебхук:

```powershell
$token = "<токен>"
$hash = (Get-FileHash -InputStream ([IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes($token))) -Algorithm SHA256).Hash.ToLower().Substring(0,16)
Invoke-RestMethod "https://api.telegram.org/bot$token/setWebhook" -Method Post -Body @{ url = "https://synaps.bond/api/telegram/$hash" }
```
