# Runbook — операции

## Учётки и идентификаторы

| Что | Значение |
|-----|----------|
| GitHub | `Sunrocketz/training-dashboard` |
| Branch деплоя UI | `main` |
| Script ID | `1jNtOi1KDqH0HltJPgBkBbZJKCvvY1191vshAxe3vZjTjquO9QG2bWphZ` |
| Deployment @HEAD (dev/head) | `AKfycbzjxGv5RjnrwtfceJyD4AfW0GQSHd72PgUbeAcC3KxC` |
| Deployment веб-UI (/exec, schema v7) | `AKfycbwCpZCfhcuynPp0431uiLZactRUvv51as0hdNfTtkHKF69eN1SD_7aBfqNjs7MKzbt9Fw` |
| Локальный GAS | `apps-script/` |

UI по умолчанию бьёт в **deployment v2** (см. `DEFAULT_APPS_SCRIPT_URL` в `index.html`).

---

## Деплой frontend (Netlify)

```bash
# из корня репо
git add <files>
git commit -m "..."
git push origin main
```

Netlify подтянет `main` сам. Проверить сайт → hard refresh.

Откат UI: revert commit / rollback deploy в Netlify UI.

---

## Деплой Apps Script (clasp)

### Предусловия

1. Включен Apps Script API: https://script.google.com/home/usersettings  
2. `npm i -g @google/clasp`
3. `clasp login` (один раз на машине)

### Залить код

```bash
cd apps-script
clasp push
```

`clasp push` обновляет **код проекта**, но активный web app может продолжать отдавать старую **версию deployment**, пока не обновишь deployment.

### Обновить веб-приложение (тот же URL)

```bash
cd apps-script
clasp deployments
clasp deploy -i AKfycbwCpZCfhcuynPp0431uiLZactRUvv51as0hdNfTtkHKF69eN1SD_7aBfqNjs7MKzbt9Fw -d "update"
```

Либо в UI: Deploy → Manage deployments → Edit → Version: New → Deploy.

**Не создавай новый deployment без причины** — получишь новый URL и придётся менять `DEFAULT_APPS_SCRIPT_URL` + Netlify.

### Обновить лист «Дашборд» внутри Sheets

В таблице: меню **Дашборд обучения → Обновить дашборд в таблице**  
или выполнить `buildDashboard` в редакторе скрипта.

---

## Типовые инциденты

### UI: «Ошибка подключения»

1. Открыть `/exec` в браузере — есть ли JSON?
2. Проверить, что deployment «Anyone» / execute as Me.
3. Сверить URL с `DEFAULT_APPS_SCRIPT_URL`.
4. CORS обычно не мешает простому GET ContentService; чаще проблема в доступе/версии.

### JSON старый после `clasp push`

Не обновлён deployment. Сделать `clasp deploy -i <id>` или New version в UI.

### Дашборд «долго грузится»

1. Первый запрос к Apps Script всегда тяжелее (чтение Sheets).  
2. Повторные открытия должны быть быстрее за счёт серверного кэша (5 мин) и локального кэша в браузере.  
3. Кнопка **Обновить** бьёт в `/exec?refresh=1` и обходит серверный кэш.  
4. Если всё равно >10с — проверить квоты Apps Script / размер листа / `DATA_END_ROW`.

### Пустые / обрезанные данные

1. Лист называется точно `Контроль штата обучения`?
2. Есть даты в колонке C?
3. Не упёрлись в `DATA_END_ROW = 500`?
4. Комментарии: «не собралась» вне расчёта; «распалась» внутри valid; действующие (D в будущем) только в старте групп — сверить DataModel / ADR-014?

### Нет блока «Оценка после линии» / `lineReview.ok: false`

1. Deployment обновлён после `clasp push` (кэш `dashboard_json_v6`)?
2. У аккаунта деплоера есть «Читатель» на книгу «Выход на линию — ОС»?
3. Первый запуск после кода: в редакторе Apps Script выполнить `collectDashboardData` и выдать доступ к Sheets (openById).
4. Лист называется точно `2026`?
5. `unmatched` большой — имена в журнале не клеятся с «Контроль штата» (фамилия + имя).

### Неверные конверсии

Сверить определение метрики в [ApiContract.md](ApiContract.md) и [DataModel.md](DataModel.md).  
Не чинить «на глаз» только во frontend.

### clasp: No credentials

```bash
clasp login
```

### Случайно закоммитили секреты

1. Не пушить дальше.
2. Убрать файл, ротировать доступ Google при необходимости.
3. `.clasprc.json` должен быть только локально (home dir).

---

## Смоук-чек после релиза

- [ ] `GET /exec` → `schemaVersion: 7`, `metrics.rankScore: tqi_v3`, есть `totals.lineReview`
- [ ] `totals.groups` ≥ `groupsCompleted`; `groupsInProgress` = разница; `finalCount` только законченные
- [ ] KPI: «Всего групп» включает в обучении; «Вышло на линию» и конверсия — без действующих
- [ ] У тренера: `groupsCompleted`, `yieldPerGroup` = final/законченные; TQI не считает идущие группы
- [ ] UI: рейтинг TQI v3, в карточке части «Балл 1–5» и «Навыки да/нет»; в JSON есть `scoreParts.skills`
- [ ] Карточка тренера: блок «После линии» (средняя 1–5, скрипт/возражения/CRM)

- [ ] Фильтр периода переключает данные; легенда порогов видна
- [ ] В шапке видно «Данные API: …»; кнопка «Экспорт CSV» скачивает файл
- [ ] Deep-link `?trainer=` / `?month=` / `?period=` открывает нужный экран; «Ссылка» копирует URL
- [ ] Вкладка тренеров: колонки взвеш./ср.%, detail с day1/итог/conv2/conv3 и отсевом
- [ ] Вкладка месяцев: карточки с отсевом, detail работает
- [ ] (Если трогали GAS) лист «Дашборд» обновляется из меню

---

## Контакты / эскалация

Пока проект соло: владелец репо + Google-аккаунт, под которым задеплоен web app.  
При смене владельца Sheets/Script — перевыпустить deployment и обновить URL.
