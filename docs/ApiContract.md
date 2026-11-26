# API Contract — JSON веб-сервиса

**Источник истины** для формы данных между Apps Script (`doGet`) и `index.html`.

- Endpoint: `GET {WEB_APP_URL}/exec`
- Content-Type: `application/json`
- Auth: нет (публичный URL)
- **schemaVersion:** `10` (текущий)
- Кэш: Script Cache на 300с, ключ `dashboard_json_v10`, JSON хранится **частями** (`_n` = число кусков, `_0…` — куски по 45 000 символов; ответ > 100KB, лимит Script Cache — 100KB на ключ, ADR-023); `?refresh=1` принудительно пересчитывает
- В ответе опционально `cache: { hit: boolean, ttlSec: number }`

Текущий deployment ID (URL `/exec`):  
`AKfycbwCpZCfhcuynPp0431uiLZactRUvv51as0hdNfTtkHKF69eN1SD_7aBfqNjs7MKzbt9Fw`

## Корневой объект

```ts
type DashboardPayload = {
  schemaVersion: number;      // сейчас 10
  updatedAt: string;
  metrics: MetricsMeta;
  totals: Totals;
  funnel: FunnelStep[];
  byTrainer: TrainerRow[];
  byMonth: MonthRow[];
  groups: GroupRow[];
  dismissals: Dismissals;     // v10: уход кандидатов из листа «Регистрация уволенных»
};
```

## `metrics`

| Поле | Тип | Смысл |
|------|-----|-------|
| `conv1to5Totals` / `ByTrainer` / `ByMonth` | string | формулы конверсий |
| `fellApartInValid` | boolean | «распалась» в valid |
| `rankScore` | string | `'tqi_v3'` |
| `rankMinGroups` / `rankMinDay1` | number | 2 / 10; порог групп — по **законченным** |
| `rankMinLineScores` | number | 2; ниже — в TQI подставляется средняя компании по журналу ОС |
| `outcomeFromCompleted` | boolean | `true`: воронка/выход/TQI-воронка только по законченным |
| `completedRule` | string | `'lineDate<=today || fellApart'` |
| `rankWeights` | object | `quality`, `line`, `skills`, `reliability`, `contribution`, `yield`, `stability` (сумма 1.0) |
| `qualityMix` | object | доли внутри quality: `conv1to5`, `conv2`, `conv3` |
| `contribFullAtShare` | number | доля итоговых выходов компании = 100 по оси вклада (0.25) |
| `reliabilityRefDay1` | number | опорный day1 для log-шкалы (200) |
| `badgeLow` / `badgeHigh` / `planConv1to5` | number | пороги UI |
| `lineReview` | object | мета журнала ОС: `periodIndependent`, `scoreMin`/`scoreMax`, `badgeLow`/`badgeHigh` (3.5/4.5), `ok`, `error` |
| `departedTrainers` | string[] | уволенные: остаются в рейтинге и линии, UI показывает «(Уволен)» |

## `totals`

| Поле | Тип | Смысл |
|------|-----|-------|
| `groups` | number | **старт групп**: все valid, включая ещё в обучении |
| `groupsCompleted` / `groupsInProgress` | number | законченные / ещё в обучении |
| `day1`…`finalCount`, отсев | number | только законченные группы |
| `notGathered` / `fellApart*` | number | не собралась (вкл. «не набралась», «не состоялась») / распалась (вкл. «расформирована»; распалась = законченная) — ADR-021 |
| `conv1to5` | number | взвешенная 1→5 по законченным |
| `leftSelfRate` / `refuseRate` / `transferRate` | number | % от day1 законченных |
| `yieldPerGroup` | number | `finalCount / groupsCompleted` |
| `avgDay1PerGroup` | number | `day1 / groupsCompleted` |
| `lineReview` | object | агрегаты журнала «Выход на линию — ОС» (не режется фильтром месяца) |

## `byTrainer[]`

| Поле | Тип | Смысл |
|------|-----|-------|
| `groups` | number | старты тренера (вкл. в обучении) |
| `groupsCompleted` / `groupsInProgress` | number | законченные / в обучении |
| `notGathered` | number | «не собралась» у тренера (в старты и TQI не входит); тренер только с такими группами в `byTrainer` не появляется |
| day1 / final / отсев / конверсии | | только законченные |
| `leftRate` / `refuseRate` / `transferRate` | number \| null | % от day1 законченных |
| `fellShare` | number | % распавшихся от **законченных** |
| `yieldPerGroup` | number \| null | final / groupsCompleted |
| `contributionShare` | number | доля `finalCount` тренера от totals.finalCount, % |
| `score` | number \| null | **TQI v3** 0–100 (воронка по законченным + линия за весь журнал) |
| `scoreParts` | object \| null | `{ quality, line, lineFill, skills, skillsFill, reliability, contribution, yield, stability }` |
| `rank` | number \| null | место среди eligible |
| `rankEligible` | boolean | ≥ `rankMinGroups` **законченных** и ≥ `rankMinDay1` |
| `lineReview` | object \| null | оценка после линии; `null` если нет склеенных строк |
| `departed` | boolean | `true` если имя в `metrics.departedTrainers` |

### `lineReview` (totals и byTrainer)

Не содержит ФИО учеников, прогноза и свободного текста.

| Поле | Тип | Смысл |
|------|-----|-------|
| `reviewed` | number | строки журнала, склеенные с тренером (totals — все склеенные) |
| `scored` | number | из них с числом 1–5 в колонке подготовки |
| `avgScore` | number \| null | среднее этих чисел, 1 знак; **не** округляем до целого |
| `scriptYesRate` / `objectionsYesRate` / `crmYesRate` | number \| null | доля «да» среди заполненных да/нет, % |
| `scriptFilled` / `objectionsFilled` / `crmFilled` | number | сколько ячеек да/нет удалось разобрать |
| `unmatched` | number | только totals: строки с тренером, которого нет в обучении |
| `skipped` | number | только totals: строки данных без имени тренера |

Склейка: срез префикса «Тренер», ключ = фамилия + имя (отчество не обязательно), `ё`=`е`. Каноническое имя — из «Контроль штата обучения».

### TQI v3

```
quality      = 0.60·C15 + 0.25·C2' + 0.15·C3'
line         = (avgScore / 5) × 100     // scored ≥ 2, иначе avg компании, иначе 60
skills       = mean(scriptYesRate, objectionsYesRate, crmYesRate)
             // только заполненные да/нет; filled ≥ 2, иначе avg компании, иначе 80
reliability  = log(day1+1)/log(201)*100
contribution = min(100, shareFinal / 0.25 * 100)
yield        = min(100, (final/groupsCompleted) / companyAvgYield * 50)
stability    = 100 − fellShare%

TQI = 0.40·quality + 0.05·line + 0.05·skills + 0.15·reliability
    + 0.20·contribution + 0.10·yield + 0.05·stability
```

`scoreParts.lineFill` / `skillsFill`: `'personal'` \| `'company'` \| `'neutral'`.

UI при фильтре месяца пересчитывает воронку той же формулой; **line и skills не режутся месяцем**. В полном рейтинге и таблице тренеров колонка **«Оценка кандидатов»** показывает `scoreParts.skills` (среднее «да» скрипт / возражения / CRM).

## `byMonth[]`

Как totals: `groups` = старты месяца; `groupsCompleted` / `groupsInProgress`; `notGathered` — не собралось в месяце (v8); day1/final/отсев/conv — только законченные.

## `groups[]`

| Поле | Тип | Смысл |
|------|-----|-------|
| `startDate` / `lineDate` | string \| null | `yyyy-MM-dd`, таймзона скрипта; UI строит по ним вкладку недель (ADR-020) — формат не менять |
| `completed` | boolean | `lineDate ≤ сегодня` **или** `fellApart` |
| `fellApart` | boolean | комментарий содержит «распалась» или «расформирована» |
| `notGathered` | boolean | v8: «не собралась» / «не набралась» / «не состоялась» — **не** valid: в суммы, старты, воронку, TQI не входит; UI показывает только счётчиком и карточкой |
| `comment` | string | v8: колонка «Комментарий» (сейчас V) как есть (тип группы: «1-ый уровень», «Force Group», «Сервисная»… или статус); ≤120 символов |
| `day4Start` / `conv4` | number | null | v9: начало 4-го дня / % конверсии с 4-го дня (колонки «Кол-во на начало 4-го дня», «% Конверсии с 4-го дня»); у старых групп `null` |
| `exitCount` / `exitPct` | number | null | v9: «Количество людей на выход» / «% на выход от 1-го дня»; у старых групп `null`. **Не** итог — сверочная копия итога, заполняется сотрудниками после выхода группы (может быть 0, пока не внесли); итог по-прежнему `finalCount` |
| day1 / final / conv* | | сырые цифры строки (для действующих в агрегаты не идут) |

## `dismissals` (v10, ADR-023)

Уход кандидатов из листа «Регистрация уволенных» (Google-форма, та же книга). Отдельный учёт: **не** входит в totals / воронку / TQI и не обязан совпадать с «Ушли сами / отказали» основного листа. Компактно: справочники + кортежи строк; UI только считает и рисует.

```ts
type Dismissals = {
  ok: boolean;                 // false — лист не прочитан (остальной дашборд работает)
  error: string | null;
  categories: { key: string; label: string }[];           // порядок = порядок в UI
  reasons: { key: string; category: string; label: string }[];
  initiators: string[];        // ['Сотрудник','Тренер','Компания','Не указан']
  trainers: string[];          // имена тренеров (каноничные из «Контроль штата»)
  rows: [number, string, number, number, number, number][];
  //     [trainerIdx, startDate 'yyyy-MM-dd' | '', day 0..10 (0 = не указан), initiatorIdx, reasonIdx, contacted 1|0|-1]
  unmatchedTrainers: number;   // строк с тренером, которого нет в обучении (имя берётся из формы как есть)
  dateFromTimestamp: number;   // строк без даты старта — взята дата отметки времени
  skipped: number;             // строки без ФИО тренера
};
```

| Ключ категории | Причины (`reasons[].key`) |
|----------------|---------------------------|
| `personal` | `changedMind`, `family`, `health`, `schedule` |
| `noshow` | `noShowStart`, `noShowNextDay`, `leftSilent` (только из свободного текста) |
| `tech` | `internet`, `equipment` |
| `skills` | `weakSkills`, `reading` |
| `discipline` | `lateness`, `ethics` |
| `company` | `companyDecision` |
| `other` | `reenroll`, `otherText`, `unknown` |

`contacted`: колонка «Связывался ли тренер» — 1 = «Да», 0 = «Нет», −1 = пусто или свой текст. Фильтр месяца в UI — по `startDate` (название месяца совпадает с `byMonth[].month`). Правила раскладки причин — [DataModel.md](DataModel.md#лист-регистрация-уволенных).

Нет в ответе: ФИО, телефон, Telegram, email кандидата, текст ОС, исходный текст причины, «Порекомендуете ли», «Доступы в CRM».

## Совместимость

- v10: новое поле `dismissals` (non-breaking: UI v9 его не читает; UI v10 при его отсутствии показывает заглушку «нет данных» на вкладке и не рисует блок в обзоре). Кэш `dashboard_json_v10` частями (ADR-023). Порядок выката любой; рекомендуется GAS → UI.

- v9: колонки листа ищутся по заголовкам (ADR-022). Новые поля `groups[]`: `day4Start`, `conv4`, `exitCount`, `exitPct` — `number | null` (у групп до ноября 2026 `null`, не 0). Ошибка чтения листа (не найдена обязательная колонка) → ответ `{ error: string }` вместо данных. Кэш `dashboard_json_v9`. Non-breaking для UI v8.
- v8: `groups[]` содержит и «не собралась» (`notGathered: true`, `completed: false`) — UI обязан исключать их из всех сумм; `groups[].comment` (колонка R как есть, ≤120 симв.); `byMonth[].notGathered`, `byTrainer[].notGathered`; синонимы статусов; кэш `dashboard_json_v8` (ADR-021). Порядок выката: сначала UI (терпит v7 и v8), потом GAS — старый UI посчитал бы «не собралась» как группы в обучении.
- v7: TQI v3 (балл 1–5 5% + навыки да/нет 5%); кэш `dashboard_json_v7d` (метка «Уволен», ADR-019).
- v6: `lineReview` у totals/byTrainer + `metrics.lineReview`; кэш `dashboard_json_v6`. TQI без изменений.
- v5: outcome-метрики только по законченным группам; новые поля `completed`, `lineDate`, `groupsCompleted`, `groupsInProgress`; ключ кэша `dashboard_json_v5`.
- v4: TQI v2; ключ `dashboard_json_v4`.
- Процесс: docs → GAS deploy → UI push. UI при отсутствии `completed` считает группу законченной (переходный кэш v4).

## Пример (фрагмент)

```json
{
  "schemaVersion": 4,
  "metrics": { "rankScore": "tqi_v2", "rankWeights": { "quality": 0.5, "reliability": 0.15, "contribution": 0.2, "yield": 0.1, "stability": 0.05 } },
  "byTrainer": [
    {
      "name": "Кузин Владимир",
      "groups": 16,
      "day1": 235,
      "finalCount": 57,
      "contributionShare": 17.4,
      "yieldPerGroup": 3.6,
      "score": 42.1,
      "rank": 1,
      "scoreParts": { "quality": 28.1, "reliability": 90.2, "contribution": 69.5, "yield": 60.4, "stability": 100 }
    }
  ]
}
```
