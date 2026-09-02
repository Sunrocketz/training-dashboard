# Модули и зоны ответственности

## Карта репозитория

```
training-dashboard/
├── index.html              # Frontend (UI + клиентская логика)
├── apps-script/
│   ├── Код.js              # Backend: агрегация, лист, doGet
│   ├── appsscript.json     # Манифест GAS (timezone, webapp)
│   └── .clasp.json         # scriptId для clasp
├── docs/                   # Документация (этот набор)
├── .cursor/rules/
│   ├── 00-project.mdc      # Главные правила (тегать)
│   ├── frontend.mdc
│   └── apps-script.mdc
├── AGENTS.md               # → 00-project.mdc
├── README.md
└── .gitignore
```

## Frontend (`index.html`)

| Зона | Ответственность | Не должен |
|------|-----------------|-----------|
| Config / connect | URL `/exec`, ручной refresh | Хранить секреты |
| Auto-refresh | Расписание 08:00 МСК | Менять данные на сервере |
| Overview tab | Баннер периода, KPI+MoM, блок «Оценка после линии», воронка, отсев, тренд, топы | Ломать взвешенную/среднюю формулы без ApiContract |
| Toolbar | Фильтр месяца, легенда порогов | Серверная фильтрация (её нет) |
| Deep-link | `?period=&trainer=&month=&tab=` + кнопка «Ссылка» | Ломать shareable URL без docs |
| CSV export | Кнопка выгрузки активной вкладки | Серверный экспорт |
| Trainers tab | Таблица, сортировка, поиск, detail | Писать в Sheets |
| Months tab | Карточки месяцев, detail | Менять контракт |
| Charts | Chart.js lifecycle (`destroyChart`) | Утекать инстансы чартов |
| Styles | Визуал дашборда | Тянуть тяжёлый UI-kit без ADR |

### Клиентские helpers

- `fetchData`, `buildViewData`, `aggregateFromGroups`, `momContext`
- `renderAll` / `renderOverview` / `renderLineReviewSection` / `renderTrainersTab` / `renderMonthsTab`
- `openTrainerDetail` / `openMonthDetail` — сводки из `groups` + отсев + `lineReview`

## Apps Script (`apps-script/Код.js`)

| Модуль (логический) | Функции | Ответственность |
|---------------------|---------|-----------------|
| Config | `SOURCE_SHEET_NAME`, `COL`, `LINE_REVIEW_*`, `EXCLUDED_TRAINERS`, диапазон | Константы схемы |
| Collect | `collectDashboardData`, `collectLineReviewPack` | Сначала журнал ОС, затем TQI v3 + payload |
| Sheet UI | `buildDashboard`, `onOpen` | Лист «Дашборд» |
| HTTP | `doGet` | JSON response |
| Utils | `normalizeName`, `foldYo`, `trainerMatchKey`, `isExcludedTrainer`, `parseScore15`, `parseYesNo`, `parsePercent`, `sumColumn`, `round1` | Нормализация |

## Внешние модули (не в git)

| Модуль | Владелец | Зависимость |
|--------|----------|-------------|
| Google Sheet (обучение) | Операционная команда | Имена листов, колонки A–R |
| Google Sheet (журнал ОС) | Операционная команда | ID книги, лист `2026`; «Читатель» аккаунту деплоера |
| Netlify site | Ты / GitHub integration | `main` branch |
| clasp credentials | Локально `~/.clasprc.json` | Не в репозитории |

## Границы изменений

| Хочешь изменить… | Трогай | Синхронно обнови |
|------------------|--------|------------------|
| Внешний вид, вкладки, UX | `index.html` | — |
| Поля JSON | `Код.js` + `index.html` | ApiContract |
| Колонки листа | Sheet + `COL` + collect | DataModel, ApiContract |
| Журнал ОС (вторая книга) | `LINE_REVIEW_*` + `collectLineReviewPack` | DataModel, ApiContract, Security |
| Частоту автообновления UI | `index.html` | Runbook (если ops-важно) |
| Доступ к web app | Deploy settings / appsscript.json | Security, Runbook |

## Правило модульности

Новый файл/пакет заводим только когда:

1. Есть ADR или явный пункт Roadmap, **и**
2. Текущий файл реально мешает (размер / конфликты / тестирование).

Иначе — расширяем существующие логические секции с комментариями-разделителями.
