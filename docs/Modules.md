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
| Deep-link | `?period=&trainer=&month=&tab=&week=` + кнопка «Ссылка» | Ломать shareable URL без docs |
| CSV export | Кнопка выгрузки активной вкладки | Серверный экспорт |
| Trainers tab | Таблица, сортировка, поиск, detail | Писать в Sheets |
| Months tab | Карточки месяцев, detail | Менять контракт |
| Weeks tab | Выбор недели (пн–вс); «Коротко о неделе»; карточки групп со статусом «сегодня» (N-й день / выход / старт скоро); 4 главные цифры к прошлой неделе; в раскрывающемся блоке — воронка (законченные + идущие), таблицы групп и тренеров, тренд 12 нед., список недель (ADR-020) | Считать TQI по неделе; применять фильтр месяца |
| Dismissals tab | «Уход кандидатов»: KPI, столбики по дням (разбивка причины / инициатор), автовыводы, тепловая таблица причина × день, инициатор по дням, тренеры, месяцы старта, фильтр тренера; блок в обзоре и в карточке тренера (ADR-023) | Раскладывать причины заново (это делает GAS); смешивать с KPI основного листа |
| Charts | Chart.js lifecycle (`destroyChart`) | Утекать инстансы чартов |
| Styles | Визуал дашборда | Тянуть тяжёлый UI-kit без ADR |

### Клиентские helpers

- `fetchData`, `buildViewData`, `aggregateFromGroups`, `momContext`
- `renderAll` / `renderOverview` / `renderLineReviewSection` / `renderTrainersTab` / `renderMonthsTab`
- `openTrainerDetail` / `openMonthDetail` — сводки из `groups` + отсев + `lineReview`; у тренера переключатель периода (`opts.scopeMonth`)
- `openGroupDetail` / `groupIndexOf` — карточка одной группы (индекс в `groups[]` как ключ)
- `validGroupsOf` / `notGatheredGroupsOf` / `isNotGathered` — v8: «не собралась» в `groups[]` только для показа (ADR-021); `groupTypeOf` / `groupTypeTag` — тип группы из комментария
- `dismissalsPayload` / `dismissalRecords` / `summarizeDismissals` / `dmInsights` / `dmDayBarsHtml` / `dmReasonsListHtml` / `dmHeatTableHtml` / `renderDismissalsTab` / `renderDismissalsOverviewSection` / `renderTrainerDismissalsBlock` / `dismissalsCsvRows` — уход кандидатов из `dismissals` (v10)
- Все `const` / `let` модульного уровня — в начале `<script>`: `renderAll` из локального кэша запускается до конца разбора скрипта
- `buildWeeksIndex` / `summarizeWeek` / `weekTrainerRows` / `renderWeeksTab` / `groupTodayState` / `groupCardHtml` / `weekBriefHtml` / `renderWeekFunnel` / `renderWeekTrendChart` — недели из `groups` (старт по `startDate`, итог по `lineDate`)

## Apps Script (`apps-script/Код.js`)

| Модуль (логический) | Функции | Ответственность |
|---------------------|---------|-----------------|
| Config | `SOURCE_SHEET_NAME`, `COL` (внутренний порядок полей), `HEADER_PATTERNS` / `REQUIRED_COLUMNS` (поиск колонок по заголовкам), `LINE_REVIEW_*`, `DEPARTED_TRAINERS`, диапазон | Константы схемы |
| Collect | `collectDashboardData`, `collectLineReviewPack`, `collectDismissals` | Сначала журнал ОС, затем TQI v3 + payload; уход кандидатов — отдельный блок |
| Dismissals | `DISMISSAL_*` (справочники, шаблоны заголовков, правила причин), `dismissalReasonKey`, `dismissalInitiatorIndex`, `dismissalDay`, `dismissalDateKey` | Лист «Регистрация уволенных» → коды без ПДн (ADR-023) |
| Cache | `cachePutChunked`, `cacheGetChunked` | JSON > 100KB частями в Script Cache |
| Sheet UI | `buildDashboard`, `onOpen` | Лист «Дашборд» |
| HTTP | `doGet` | JSON response |
| Utils | `readSourceRows`, `mapHeaderRow`, `normalizeHeader`, `numOrNull`, `groupStatusFromComment`, `normalizeName`, `foldYo`, `trainerMatchKey`, `isDepartedTrainer`, `parseScore15`, `parseYesNo`, `parsePercent`, `sumColumn`, `round1` | Нормализация |

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
