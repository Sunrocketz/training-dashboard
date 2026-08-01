# API Contract — JSON веб-сервиса

**Источник истины** для формы данных между Apps Script (`doGet`) и `index.html`.

- Endpoint: `GET {WEB_APP_URL}/exec`
- Content-Type: `application/json`
- Auth: нет (публичный URL)
- **schemaVersion:** `3` (текущий)
- Кэш: Script Cache на 300с (`dashboard_json_v3`); `?refresh=1` принудительно пересчитывает
- В ответе опционально `cache: { hit: boolean, ttlSec: number }`

Текущий deployment ID (URL `/exec`):  
`AKfycbwCpZCfhcuynPp0431uiLZactRUvv51as0hdNfTtkHKF69eN1SD_7aBfqNjs7MKzbt9Fw`

## Корневой объект

```ts
type DashboardPayload = {
  schemaVersion: number;      // сейчас 3
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
| `fellApartInValid` | boolean | `true` — «распалась» входит в valid с меткой |
| `badgeLow` | number | порог «средне» (20) |
| `badgeHigh` | number | порог «хорошо» (30) |
| `planConv1to5` | number | план конверсии для KPI (30) |

## `totals`

| Поле | Тип | Смысл |
|------|-----|-------|
| `groups` | number | Число valid-групп (**включая** распавшиеся) |
| `notGathered` | number | «Не собралась» — вне valid |
| `fellApart` | number | Число групп с меткой «распалась» (они же в `groups`) |
| `fellApartDay1` / `fellApartFinalCount` | number | Суммы day1/final только по распавшимся |
| `fellApartConv1to5` | number \| null | Взвешенная конверсия распавшихся: `fellApartFinal/fellApartDay1*100` |
| `fellApartShare` | number | Доля распавшихся: `fellApart/groups*100` |
| `day1` … `finalCount` | number | Суммы по всем valid |
| `leftSelf` / `refused` / `transferred` | number | Отсев |
| `conv1to5` | number | **Взвешенная** конверсия 1→5 по всем valid: `finalCount/day1*100` |

При фильтре месяца на UI: `notGathered` = `null` (нет разбивки в API); `fellApart*` пересчитываются из `groups[].fellApart`.

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
| `fellApart` | number | Сколько групп тренера с меткой «распалась» |
| `conv1to5` | number \| null | Среднее % по группам тренера |
| `conv1to5Weighted` | number \| null | **Взвешенная** `finalCount/day1*100` (как totals) |
| `fellApartConv1to5` | number \| null | Взвешенная конверсия только по распавшимся группам тренера |
| `conv2` / `conv3` | number \| null | Средние по группам, где есть значение |

> Два поля конверсии 1→5 — осознанно (ADR-004 / ADR-007). UI по умолчанию опирается на `conv1to5Weighted` для операционного сравнения.

## `byMonth[]`

| Поле | Тип | Смысл |
|------|-----|-------|
| `month` | string | Первая часть `monthGroup` до запятой |
| `groups` | number | Число групп (вкл. распавшиеся) |
| `fellApart` | number | Распавшиеся в месяце |
| `day1` / `finalCount` | number | Суммы |
| `leftSelf` / `refused` / `transferred` | number | Отсев за месяц |
| `conv1to5` | number \| null | Взвешенная `final/day1*100` |
| `fellApartConv1to5` | number \| null | Взвешенная конверсия только распавшихся за месяц |

Порядок — порядок первого появления месяца в данных.

## `groups[]`

Valid-группы (включая распавшиеся):

| Поле | Тип | Смысл |
|------|-----|-------|
| `label`, `month`, `trainer`, `startDate` | string \| null | Метки |
| `fellApart` | boolean | `true` если в комментарии «распалась» |
| `day1`, `day2Start`, `day3Start`, `finalCount`, … | number | Воронка / отсев |
| `conv1to5` / `conv2` / `conv3` | number \| null | % 0–100 |

## Правила совместимости

### Non-breaking

- Новые опциональные поля (`fellApart` на group/trainer/month, `fellApartConv1to5`, …)

### Breaking / semantic

- Смена состава valid («распалась» теперь внутри) — `schemaVersion: 3`, новый ключ кэша
- Удаление / переименование полей
- Смена формулы существующего поля без нового имени

### Процесс изменения

1. Обновить этот файл  
2. ADR при смене модели  
3. GAS + UI  
4. `clasp push` + deploy → push UI  

## Пример (фрагмент v3)

```json
{
  "schemaVersion": 3,
  "metrics": {
    "conv1to5Totals": "weighted",
    "conv1to5ByTrainer": "avgGroups",
    "conv1to5ByMonth": "weighted",
    "fellApartInValid": true,
    "badgeLow": 20,
    "badgeHigh": 30,
    "planConv1to5": 30
  },
  "totals": {
    "groups": 110,
    "notGathered": 9,
    "fellApart": 3,
    "fellApartDay1": 48,
    "fellApartFinalCount": 2,
    "fellApartConv1to5": 4.2,
    "fellApartShare": 2.7,
    "conv1to5": 28.5
  },
  "groups": [
    {
      "label": "Июль, Группа обучения 2",
      "trainer": "Селиванова Олеся",
      "fellApart": true,
      "day1": 16,
      "finalCount": 0
    }
  ]
}
```
