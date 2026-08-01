# API Contract — JSON веб-сервиса

**Источник истины** для формы данных между Apps Script (`doGet`) и `index.html`.

- Endpoint: `GET {WEB_APP_URL}/exec`
- Content-Type: `application/json`
- Auth: нет (публичный URL)
- **schemaVersion:** `4` (текущий)
- Кэш: Script Cache на 300с (`dashboard_json_v4`); `?refresh=1` принудительно пересчитывает
- В ответе опционально `cache: { hit: boolean, ttlSec: number }`

Текущий deployment ID (URL `/exec`):  
`AKfycbwCpZCfhcuynPp0431uiLZactRUvv51as0hdNfTtkHKF69eN1SD_7aBfqNjs7MKzbt9Fw`

## Корневой объект

```ts
type DashboardPayload = {
  schemaVersion: number;      // сейчас 4
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
| `rankMinGroups` / `rankMinDay1` | number | 2 / 10 |
| `rankWeights` | object | `quality`, `reliability`, `contribution`, `yield`, `stability` (сумма 1.0) |
| `qualityMix` | object | доли внутри quality: `conv1to5`, `conv2`, `conv3` |
| `contribFullAtShare` | number | доля итоговых выходов компании = 100 по оси вклада (0.25) |
| `reliabilityRefDay1` | number | опорный day1 для log-шкалы (200) |
| `badgeLow` / `badgeHigh` / `planConv1to5` | number | пороги UI |

## `totals`

| Поле | Тип | Смысл |
|------|-----|-------|
| `groups`, `day1`…`finalCount`, отсев | number | как раньше |
| `notGathered` / `fellApart*` | number | не собралась / распалась |
| `conv1to5` | number | взвешенная 1→5 |
| `leftSelfRate` / `refuseRate` / `transferRate` | number | % от day1 |
| `yieldPerGroup` | number | `finalCount/groups` |
| `avgDay1PerGroup` | number | `day1/groups` |

## `byTrainer[]`

| Поле | Тип | Смысл |
|------|-----|-------|
| базовые суммы / конверсии | | как в v3 |
| `leftRate` / `refuseRate` / `transferRate` | number \| null | % от day1 тренера |
| `fellShare` | number | % распавшихся групп |
| `yieldPerGroup` | number \| null | final/groups |
| `contributionShare` | number | доля `finalCount` тренера от totals.finalCount, % |
| `score` | number \| null | **TQI v2** 0–100 |
| `scoreParts` | object \| null | `{ quality, reliability, contribution, yield, stability }` |
| `rank` | number \| null | место среди eligible |
| `rankEligible` | boolean | проходит пороги min groups/day1 |

### TQI v2

```
quality      = 0.60·C15 + 0.25·C2' + 0.15·C3'
reliability  = log(day1+1)/log(201)*100
contribution = min(100, shareFinal / 0.25 * 100)
yield        = min(100, (final/groups) / companyAvgYield * 50)
stability    = 100 − fellShare%

TQI = 0.50·quality + 0.15·reliability + 0.20·contribution
    + 0.10·yield + 0.05·stability
```

UI при фильтре месяца пересчитывает score/rank той же формулой относительно totals области.

## `byMonth[]` / `groups[]`

Как в schema v3 (+ `fellApart` на группе/месяце).

## Совместимость

- v4: semantic change `score` (новая формула) + новые поля; ключ кэша сменён.
- Процесс: docs → GAS deploy → UI push.

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
