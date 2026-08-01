# Training Dashboard

Дашборд контроля штата обучения: агрегаты по группам тренеров из Google Sheets → JSON API (Apps Script) → статический веб-UI на Netlify.

## Стек

| Слой | Технология | Где код |
|------|------------|---------|
| Данные | Google Sheets | лист «Контроль штата обучения» |
| Backend / API | Google Apps Script (V8) | `apps-script/` |
| Frontend | HTML + CSS + JS + Chart.js | `index.html` |
| Хостинг UI | Netlify ← GitHub `main` | деплой из git |
| Локальная синхронизация GAS | `clasp` | `apps-script/.clasp.json` |

## Быстрый старт

1. Клонировать репозиторий.
2. UI: открыть `index.html` локально или смотреть деплой Netlify.
3. Apps Script: `cd apps-script && clasp push` (нужен `clasp login`).
4. Документация: начать с [docs/Index.md](docs/Index.md).

## Потоки данных

```
Google Sheets
    → Apps Script collectDashboardData()
        → лист «Дашборд» (buildDashboard)
        → HTTP JSON doGet() /exec
            → index.html (fetch + Chart.js)
```

## Важные ссылки

- Репозиторий: https://github.com/Sunrocketz/training-dashboard
- Script ID: `1jNtOi1KDqH0HltJPgBkBbZJKCvvY1191vshAxe3vZjTjquO9QG2bWphZ`
- Активный `/exec` deployment ID: `AKfycbwCpZCfhcuynPp0431uiLZactRUvv51as0hdNfTtkHKF69eN1SD_7aBfqNjs7MKzbt9Fw`

## Документация

Полный индекс: **[docs/Index.md](docs/Index.md)**

Правила (тегать в чате): **[.cursor/rules/00-project.mdc](.cursor/rules/00-project.mdc)**
