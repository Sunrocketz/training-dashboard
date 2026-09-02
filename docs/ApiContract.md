# API Contract — JSON веб-сервиса

**Источник истины** для формы данных между Apps Script (`doGet`) и `index.html`.

- Endpoint: `GET {WEB_APP_URL}/exec`
- Content-Type: `application/json`
- Auth: нет (публичный URL)
- **schemaVersion:** `6` (текущий)
- Кэш: Script Cache на 300с (`dashboard_json_v6`); `?refresh=1` принудительно пересчитывает
- В ответе опционально `cache: { hit: boolean, ttlSec: number }`

Текущий deployment ID (URL `/exec`):  
`AKfycbwCpZCfhcuynPp0431uiLZactRUvv51as0hdNfTtkHKF69eN1SD_7aBfqNjs7MKzbt9Fw`

## Корневой объект

```ts
type DashboardPayload = {
  schemaVersion: number;      // сейчас 6
  updatedAt: string;
  metrics: MetricsMeta;
  totals: Totals;
  funnel: FunnelStep[];
  byTrainer: TrainerRow[];
  byMonth: MonthRow[];
  groups: GroupRow[];
};
```

## `metrics`

| Поле | Тип | Смысл |
|------|-----|-------|
| `conv1to5Totals` / `ByTrainer` / `ByMonth` | string | формулы конверсий |
| `fellApartInValid` | boolean | «распалась» в valid |
| `rankScore` | string | `'tqi_v2'` |
| `rankMinGroups` / `rankMinDay1` | number | 2 / 10; порог групп — по **законченным** |
| `outcomeFromCompleted` | boolean | `true`: воронка/выход/TQI только по законченным |
| `completedRule` | string | `'lineDate<=today || fellApart'` |
| `rankWeights` | object | `quality`, `reliability`, `contribution`, `yield`, `stability` (сумма 1.0) |
| `qualityMix` | object | доли внутри quality: `conv1to5`, `conv2`, `conv3` |
| `contribFullAtShare` | number | доля итоговых выходов компании = 100 по оси вклада (0.25) |
| `reliabilityRefDay1` | number | опорный day1 для log-шкалы (200) |
| `badgeLow` / `badgeHigh` / `planConv1to5` | number | пороги UI |
| `lineReview` | object | мета журнала ОС: `periodIndependent`, `scoreMin`/`scoreMax`, `badgeLow`/`badgeHigh` (3.5/4.5), `ok`, `error` |

## `totals`

| Поле | Тип | Смысл |
|------|-----|-------|
| `groups` | number | **старт групп**: все valid, включая ещё в обучении |
| `groupsCompleted` / `groupsInProgress` | number | законченные / ещё в обучении |
| `day1`…`finalCount`, отсев | number | только законченные группы |
| `notGathered` / `fellApart*` | number | не собралась / распалась (распалась = законченная) |
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
| day1 / final / отсев / конверсии | | только законченные |
| `leftRate` / `refuseRate` / `transferRate` | number \| null | % от day1 законченных |
| `fellShare` | number | % распавшихся от **законченных** |
| `yieldPerGroup` | number \| null | final / groupsCompleted |
| `contributionShare` | number | доля `finalCount` тренера от totals.finalCount, % |
| `score` | number \| null | **TQI v2** 0–100 (по законченным) |
| `scoreParts` | object \| null | `{ quality, reliability, contribution, yield, stability }` |
| `rank` | number \| null | место среди eligible |
| `rankEligible` | boolean | ≥ `rankMinGroups` **законченных** и ≥ `rankMinDay1` |
| `lineReview` | object \| null | оценка после линии; `null` если нет склеенных строк |

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

Склейка: срез префикса «Тренер», ключ = фамилия + имя (отчество не обязательно). Каноническое имя — из «Контроль штата обучения».

### TQI v2

```
quality      = 0.60·C15 + 0.25·C2' + 0.15·C3'
reliability  = log(day1+1)/log(201)*100
contribution = min(100, shareFinal / 0.25 * 100)
yield        = min(100, (final/groupsCompleted) / companyAvgYield * 50)
stability    = 100 − fellShare%   // fellApart / groupsCompleted

TQI = 0.50·quality + 0.15·reliability + 0.20·contribution
    + 0.10·yield + 0.05·stability
```

UI при фильтре месяца пересчитывает score/rank той же формулой относительно totals области.

## `byMonth[]`

Как totals: `groups` = старты месяца; `groupsCompleted` / `groupsInProgress`; day1/final/отсев/conv — только законченные.

## `groups[]`

| Поле | Тип | Смысл |
|------|-----|-------|
| `startDate` / `lineDate` | string \| null | `yyyy-MM-dd`, таймзона скрипта |
| `completed` | boolean | `lineDate ≤ сегодня` **или** `fellApart` |
| `fellApart` | boolean | комментарий содержит «распалась» |
| day1 / final / conv* | | сырые цифры строки (для действующих в агрегаты не идут) |

## Совместимость

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
