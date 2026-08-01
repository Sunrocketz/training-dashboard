# API Contract — JSON веб-сервиса

**Источник истины** для формы данных между Apps Script (`doGet`) и `index.html`.

- Endpoint: `GET {WEB_APP_URL}/exec`
- Content-Type: `application/json`
- Auth: нет (публичный URL)
- **schemaVersion:** `2` (текущий)

Текущий deployment ID (URL `/exec`):  
`AKfycbwCpZCfhcuynPp0431uiLZactRUvv51as0hdNfTtkHKF69eN1SD_7aBfqNjs7MKzbt9Fw`

## Корневой объект

```ts
type DashboardPayload = {
  schemaVersion: number;      // сейчас 2
  updatedAt: string;          // yyyy-MM-dd'T'HH:mm:ss (timezone скрипта)
  metrics: MetricsMeta;
  totals: Totals;
  funnel: FunnelStep[];
  byTrainer: TrainerRow[];
  byMonth: MonthRow[];
  groups: GroupRow[];
};
```

## `metrics` (мета для UI)

| Поле | Тип | Смысл |
|------|-----|-------|
| `conv1to5Totals` | string | `'weighted'` — `finalSum/day1Sum` |
| `conv1to5ByTrainer` | string | `'avgGroups'` — среднее % групп в поле `conv1to5` |
| `conv1to5ByMonth` | string | `'weighted'` |
| `badgeLow` | number | порог «средне» (20) |
| `badgeHigh` | number | порог «хорошо» (30) |
| `planConv1to5` | number | план конверсии для KPI (30) |

## `totals`

| Поле | Тип | Смысл |
|------|-----|-------|
| `groups` | number | Число valid-групп |
| `notGathered` / `fellApart` | number | Не собралась / распалась (только полный период) |
| `day1` … `finalCount` | number | Суммы |
| `leftSelf` / `refused` / `transferred` | number | Отсев |
| `conv1to5` | number | **Взвешенная** конверсия 1→5: `finalCount/day1*100` |

## `funnel[]`

```ts
{ label: string; value: number }
```

Порядок: `1-й день` → `2-й день` → `3-й день` → `Выход на линию`.

## `byTrainer[]`

| Поле | Тип | Смысл |
|------|-----|-------|
| `name` | string | Нормализованное имя |
| `groups`, `day1`, `leftSelf`, `refused`, `transferred`, `finalCount` | number | Суммы / счётчики |
| `conv1to5` | number \| null | Среднее % по группам тренера |
| `conv1to5Weighted` | number \| null | **Взвешенная** `finalCount/day1*100` (как totals) |
| `conv2` / `conv3` | number \| null | Средние по группам, где есть значение |

> Два поля конверсии 1→5 — осознанно (ADR-004 / ADR-007). UI по умолчанию опирается на `conv1to5Weighted` для операционного сравнения.

## `byMonth[]`

| Поле | Тип | Смысл |
|------|-----|-------|
| `month` | string | Первая часть `monthGroup` до запятой |
| `groups` | number | Число групп |
| `day1` / `finalCount` | number | Суммы |
| `leftSelf` / `refused` / `transferred` | number | Отсев за месяц |
| `conv1to5` | number \| null | Взвешенная `final/day1*100` |

Порядок — порядок первого появления месяца в данных.

## `groups[]`

Без изменений по смыслу: valid-группы с полями `label`, `month`, `trainer`, `startDate`, воронка и конверсии.

## Правила совместимости

### Non-breaking

- Новые опциональные поля (`schemaVersion`, `metrics`, `conv1to5Weighted`, отсев в `byMonth`)

### Breaking

- Удаление / переименование полей
- Смена формулы существующего поля без нового имени

### Процесс изменения

1. Обновить этот файл  
2. ADR при смене модели  
3. GAS + UI  
4. `clasp push` + deploy → push UI  

## Пример (фрагмент v2)

```json
{
  "schemaVersion": 2,
  "metrics": {
    "conv1to5Totals": "weighted",
    "conv1to5ByTrainer": "avgGroups",
    "conv1to5ByMonth": "weighted",
    "badgeLow": 20,
    "badgeHigh": 30,
    "planConv1to5": 30
  },
  "byTrainer": [
    {
      "name": "Иванов",
      "groups": 2,
      "day1": 20,
      "finalCount": 8,
      "leftSelf": 3,
      "refused": 2,
      "transferred": 1,
      "conv1to5": 42.5,
      "conv1to5Weighted": 40
    }
  ],
  "byMonth": [
    {
      "month": "Январь",
      "groups": 2,
      "day1": 20,
      "finalCount": 8,
      "leftSelf": 3,
      "refused": 2,
      "transferred": 1,
      "conv1to5": 40
    }
  ]
}
```
