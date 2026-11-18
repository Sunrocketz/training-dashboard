/**
 * СКРИПТ ДАШБОРДА + ВЕБ-СЕРВИС ДЛЯ АВТООБНОВЛЕНИЯ
 * ==================================================
 *
 * ЧАСТЬ 1 — как раньше: строит лист "Дашборд" внутри самой таблицы.
 * ЧАСТЬ 2 — новое: публикует АГРЕГИРОВАННЫЕ данные (без имён учеников)
 *           как отдельный веб-адрес (JSON), который сам может
 *           периодически забирать внешний веб-дашборд.
 *
 * УСТАНОВКА:
 * 1. Открой таблицу → Расширения → Apps Script
 * 2. Замени весь код на этот файл целиком
 * 3. Сохрани
 * 4. Чтобы обновить дашборд внутри таблицы — выбери функцию
 *    buildDashboard и нажми Выполнить (как и раньше)
 *
 * ПУБЛИКАЦИЯ ВЕБ-СЕРВИСА (для внешнего дашборда):
 * 1. Наверху справа нажми синюю кнопку "Развернуть" (Deploy) →
 *    "Новое развёртывание" (New deployment)
 * 2. Тип развёртывания — выбери "Веб-приложение" (Web app)
 * 3. "Кто выполняет" (Execute as) — "Я" (Me)
 * 4. "У кого есть доступ" (Who has access) — "Все" (Anyone)
 *    (это и есть та самая непубличная, но не защищённая паролем
 *    ссылка — см. пояснения в чате)
 * 5. Нажми "Развернуть", разреши доступ, скопируй появившийся URL
 *    (заканчивается на /exec)
 * 6. Этот URL нужно будет вставить в веб-дашборд
 *
 * ВАЖНО: если позже поменяешь код, нужно создавать НОВОЕ развёртывание
 * (Deploy → Manage deployments → Edit → New version), иначе ссылка
 * будет отдавать старую версию кода.
 */

// ========== НАСТРОЙКИ — поменяй под себя, если нужно ==========
var SOURCE_SHEET_NAME = 'Контроль штата обучения'; // название листа с исходными данными
var DASHBOARD_SHEET_NAME = 'Дашборд';               // название листа с результатом внутри таблицы
var DATA_START_ROW = 1;   // с какой строки начинать чтение
var DATA_END_ROW = 500;   // до какой строки читать (с запасом)
// Колонки ищем по НАЗВАНИЯМ заголовков (ADR-022), а не по буквам — перестановка колонок в листе дашборд не ломает.
var API_CACHE_KEY = 'dashboard_json_v9';
var COMMENT_MAX_LEN = 120; // колонка «Комментарий» в groups[].comment — обрезаем на всякий случай
var API_CACHE_TTL_SEC = 300; // 5 минут — повторные открытия дашборда без пересчёта листа

// Журнал «Выход на линию — ОС» (другая книга). Нужен доступ «Читатель» у аккаунта деплоера.
var LINE_REVIEW_SPREADSHEET_ID = '1uNE9nPtI2JxnbBSf1YQXd8BC991tkVL5nWF77YKyrmI';
var LINE_REVIEW_SHEET_NAME = '2026';
var LINE_REVIEW_DATA_END_ROW = 500;
var LINE_REVIEW_LAST_COLUMN = 'M';
// Уволенные: остаются в рейтинге и линии, в UI метка «(Уволен)» (ADR-019).
var DEPARTED_TRAINERS = ['Селиванова Олеся', 'Вовчак Лариса', 'Фишер Артем'];
// =================================================================

// Внутренний (канонический) порядок полей строки. Это НЕ буквы листа: строка листа раскладывается
// в этот порядок функцией readSourceRows() по заголовкам. Остальной код читает row[COL.x].
var COL = {
  monthGroup: 0, trainer: 1, startDate: 2, lineDate: 3, day1: 4,
  leftSelf: 5, leftSelfPct: 6, refused: 7, refusedPct: 8,
  transferred: 9, transferredPct: 10, day2Start: 11, conv2: 12,
  finalCount: 13, conv1to5: 14, day3Start: 15, conv3: 16, comment: 17,
  day4Start: 18, conv4: 19, exitCount: 20, exitPct: 21
};
var COL_COUNT = 22;

// Заголовок листа → поле. Сравниваем нормализованный текст (нижний регистр, ё=е, пробелы схлопнуты),
// поэтому хвосты вроде «(ПЛАН 37%)» и переносы строк не мешают. Порядок проверки важен: первое совпадение.
var HEADER_PATTERNS = [
  ['monthGroup', /^месяц,\s*группа/],
  ['trainer', /^тренер группы/],
  ['startDate', /^дата старта/],
  ['lineDate', /^дат[ьа] выхода/],              // в листе опечатка «Дать выхода на линию»
  ['day1', /вышло на 1-?[ыо]?й день/],
  ['leftSelfPct', /^% ушли сами/],
  ['leftSelf', /ушли сами/],
  ['refusedPct', /^% отказа/],
  ['refused', /отказали мы/],
  ['transferredPct', /^% переноса/],
  ['transferred', /перенесли/],
  ['conv2', /конверси\S* с 2-го дня/],
  ['day2Start', /начало 2-го дня/],
  ['conv3', /конверси\S* с 3-го дня/],
  ['day3Start', /начало 3-го дня/],
  ['conv4', /конверси\S* с 4-го дня/],
  ['day4Start', /начало 4-го дня/],
  ['conv1to5', /^% с 1-го по 5/],
  ['finalCount', /выход группы на линию/],       // итог «Сколько людей на выход группы на линию»
  ['exitPct', /^% на выход/],
  ['exitCount', /^количество людей на выход/],
  ['comment', /^комментари/]
];
// Без этих колонок считать нельзя — лучше упасть с понятной ошибкой, чем отдать неверные цифры.
var REQUIRED_COLUMNS = ['monthGroup', 'trainer', 'startDate', 'lineDate', 'day1', 'leftSelf',
  'refused', 'transferred', 'day2Start', 'day3Start', 'finalCount', 'comment'];

var LINE_COL = {
  employee: 0, // A — ФИО, в JSON не отдаём
  trainer: 2,  // C
  script: 3,   // D да/нет (E — комментарий, не читаем)
  objections: 5, // F да/нет (G — комментарий)
  crm: 7,      // H да/нет (I — комментарий)
  score: 12    // M подготовка 1–5; L прогноз не берём
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Дашборд обучения')
    .addItem('Обновить дашборд в таблице', 'buildDashboard')
    .addToUi();
}

// ======================================================
// ЧАСТЬ 1: сбор и агрегация данных (общая логика)
// ======================================================
function collectDashboardData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sourceSheet = ss.getSheetByName(SOURCE_SHEET_NAME);
  if (!sourceSheet) {
    throw new Error('Не найден лист "' + SOURCE_SHEET_NAME + '"');
  }

  var values = readSourceRows(sourceSheet);

  // validEntry = { row, fellApart, completed }; «не собралась» — вне расчёта (но в groups[] с меткой), «распалась» — в valid с меткой
  var tz = Session.getScriptTimeZone();
  var todayKey = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var validGroups = [];
  var notGatheredGroups = [];
  var allEntries = []; // порядок строк листа: valid + «не собралась» — для groups[]
  var notGathered = 0;
  var fellApart = 0;

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var startDate = row[COL.startDate];
    if (!(startDate instanceof Date)) continue;

    var status = groupStatusFromComment(row[COL.comment]);
    if (status.notGathered) {
      notGathered++;
      var ngEntry = { row: row, notGathered: true, fellApart: false, completed: false };
      notGatheredGroups.push(ngEntry);
      allEntries.push(ngEntry);
      continue;
    }
    if (status.fellApart) fellApart++;
    var entry = {
      row: row,
      notGathered: false,
      fellApart: status.fellApart,
      completed: status.fellApart || isLineDateReached(row[COL.lineDate], todayKey, tz)
    };
    validGroups.push(entry);
    allEntries.push(entry);
  }

  var completedGroups = validGroups.filter(function(e) { return e.completed; });

  // ---- по тренерам ----
  var byTrainer = {};
  validGroups.forEach(function(entry) {
    var row = entry.row;
    var trainer = normalizeName(row[COL.trainer]);
    if (!byTrainer[trainer]) {
      byTrainer[trainer] = {
        name: trainer, groups: 0, groupsCompleted: 0, groupsInProgress: 0,
        fellApart: 0, day1Total: 0, leftSelf: 0, refused: 0,
        transferred: 0, finalCount: 0, fellApartDay1: 0, fellApartFinal: 0,
        conv1to5Sum: 0, conv2Sum: 0, conv3Sum: 0,
        conv2Count: 0, conv3Count: 0
      };
    }
    var t = byTrainer[trainer];
    t.groups += 1;
    if (!entry.completed) {
      t.groupsInProgress += 1;
      return;
    }
    t.groupsCompleted += 1;
    if (entry.fellApart) {
      t.fellApart += 1;
      t.fellApartDay1 += Number(row[COL.day1]) || 0;
      t.fellApartFinal += Number(row[COL.finalCount]) || 0;
    }
    t.day1Total += Number(row[COL.day1]) || 0;
    t.leftSelf += Number(row[COL.leftSelf]) || 0;
    t.refused += Number(row[COL.refused]) || 0;
    t.transferred += Number(row[COL.transferred]) || 0;
    t.finalCount += Number(row[COL.finalCount]) || 0;

    var c15 = parsePercent(row[COL.conv1to5]);
    if (c15 !== null) t.conv1to5Sum += c15;
    var c2 = parsePercent(row[COL.conv2]);
    if (c2 !== null) { t.conv2Sum += c2; t.conv2Count += 1; }
    var c3 = parsePercent(row[COL.conv3]);
    if (c3 !== null) { t.conv3Sum += c3; t.conv3Count += 1; }
  });

  // «не собралась» у тренера: только счётчик, в старты/TQI не входит (ADR-021).
  // Тренер, у которого есть только несобравшиеся группы, в byTrainer не появляется — его видно в groups[].
  notGatheredGroups.forEach(function(entry) {
    var t = byTrainer[normalizeName(entry.row[COL.trainer])];
    if (t) t.notGathered = (t.notGathered || 0) + 1;
  });

  var trainerList = Object.keys(byTrainer).sort().map(function(name) {
    var t = byTrainer[name];
    return {
      name: t.name,
      groups: t.groups,
      groupsCompleted: t.groupsCompleted,
      groupsInProgress: t.groupsInProgress,
      notGathered: t.notGathered || 0,
      fellApart: t.fellApart,
      day1: t.day1Total,
      leftSelf: t.leftSelf,
      refused: t.refused,
      transferred: t.transferred,
      finalCount: t.finalCount,
      // среднее % по законченным группам (историческое поле)
      conv1to5: t.groupsCompleted > 0 ? round1(t.conv1to5Sum / t.groupsCompleted * 100) : null,
      // взвешенная конверсия: сумма final / сумма day1 законченных
      conv1to5Weighted: t.day1Total > 0 ? round1(t.finalCount / t.day1Total * 100) : null,
      fellApartConv1to5: t.fellApartDay1 > 0 ? round1(t.fellApartFinal / t.fellApartDay1 * 100) : null,
      conv2: t.conv2Count > 0 ? round1(t.conv2Sum / t.conv2Count * 100) : null,
      conv3: t.conv3Count > 0 ? round1(t.conv3Sum / t.conv3Count * 100) : null
    };
  });

  // ---- по месяцам (для тренда + отсев) ----
  var byMonth = {};
  var monthOrder = [];
  // обходим в порядке листа, чтобы месяц с одними «не собралась» тоже встал на своё место
  allEntries.forEach(function(entry) {
    var row = entry.row;
    var label = String(row[COL.monthGroup] || '');
    var month = label.split(',')[0].trim() || 'Без месяца';
    if (!byMonth[month]) {
      byMonth[month] = {
        month: month, groups: 0, groupsCompleted: 0, groupsInProgress: 0, notGathered: 0,
        fellApart: 0, day1Total: 0, finalCount: 0,
        leftSelf: 0, refused: 0, transferred: 0,
        fellApartDay1: 0, fellApartFinal: 0
      };
      monthOrder.push(month);
    }
    if (entry.notGathered) {
      byMonth[month].notGathered += 1;
      return;
    }
    byMonth[month].groups += 1;
    if (!entry.completed) {
      byMonth[month].groupsInProgress += 1;
      return;
    }
    byMonth[month].groupsCompleted += 1;
    if (entry.fellApart) {
      byMonth[month].fellApart += 1;
      byMonth[month].fellApartDay1 += Number(row[COL.day1]) || 0;
      byMonth[month].fellApartFinal += Number(row[COL.finalCount]) || 0;
    }
    byMonth[month].day1Total += Number(row[COL.day1]) || 0;
    byMonth[month].finalCount += Number(row[COL.finalCount]) || 0;
    byMonth[month].leftSelf += Number(row[COL.leftSelf]) || 0;
    byMonth[month].refused += Number(row[COL.refused]) || 0;
    byMonth[month].transferred += Number(row[COL.transferred]) || 0;
  });
  var monthList = monthOrder.map(function(m) {
    var d = byMonth[m];
    return {
      month: d.month,
      groups: d.groups,
      groupsCompleted: d.groupsCompleted,
      groupsInProgress: d.groupsInProgress,
      notGathered: d.notGathered,
      fellApart: d.fellApart,
      day1: d.day1Total,
      finalCount: d.finalCount,
      leftSelf: d.leftSelf,
      refused: d.refused,
      transferred: d.transferred,
      conv1to5: d.day1Total > 0 ? round1(d.finalCount / d.day1Total * 100) : null,
      fellApartConv1to5: d.fellApartDay1 > 0 ? round1(d.fellApartFinal / d.fellApartDay1 * 100) : null
    };
  });

  var groupList = allEntries.map(function(entry) {
    var row = entry.row;
    var label = String(row[COL.monthGroup] || '');
    var month = label.split(',')[0].trim() || 'Без месяца';
    return {
      label: label,
      month: month,
      trainer: normalizeName(row[COL.trainer]),
      startDate: formatSheetDate(row[COL.startDate], tz),
      lineDate: formatSheetDate(row[COL.lineDate], tz),
      completed: !!entry.completed,
      fellApart: !!entry.fellApart,
      notGathered: !!entry.notGathered,
      // колонка R как есть (тип/статус группы); по решению владельца выводится в UI (ADR-021, Security)
      comment: String(row[COL.comment] || '').trim().slice(0, COMMENT_MAX_LEN),
      day1: Number(row[COL.day1]) || 0,
      leftSelf: Number(row[COL.leftSelf]) || 0,
      refused: Number(row[COL.refused]) || 0,
      transferred: Number(row[COL.transferred]) || 0,
      day2Start: Number(row[COL.day2Start]) || 0,
      day3Start: Number(row[COL.day3Start]) || 0,
      finalCount: Number(row[COL.finalCount]) || 0,
      conv1to5: (function(){ var v = parsePercent(row[COL.conv1to5]); return v !== null ? round1(v*100) : null; })(),
      conv2: (function(){ var v = parsePercent(row[COL.conv2]); return v !== null ? round1(v*100) : null; })(),
      conv3: (function(){ var v = parsePercent(row[COL.conv3]); return v !== null ? round1(v*100) : null; })(),
      // v9: новые колонки листа (с ноября 2026); у старых групп пусто → null (ADR-022)
      day4Start: numOrNull(row[COL.day4Start]),
      conv4: (function(){ var v = parsePercent(row[COL.conv4]); return v !== null ? round1(v*100) : null; })(),
      exitCount: numOrNull(row[COL.exitCount]),
      exitPct: (function(){ var v = parsePercent(row[COL.exitPct]); return v !== null ? round1(v*100) : null; })()
    };
  });

  // ---- общие итоги: старт групп = все valid; outcome — только законченные ----
  var totalGroups = validGroups.length;
  var totalCompleted = completedGroups.length;
  var totalInProgress = totalGroups - totalCompleted;
  var totalDay1 = sumEntryColumn(completedGroups, COL.day1);
  var totalDay2Start = sumEntryColumn(completedGroups, COL.day2Start);
  var totalDay3Start = sumEntryColumn(completedGroups, COL.day3Start);
  var totalLeftSelf = sumEntryColumn(completedGroups, COL.leftSelf);
  var totalRefused = sumEntryColumn(completedGroups, COL.refused);
  var totalTransferred = sumEntryColumn(completedGroups, COL.transferred);
  var totalFinal = sumEntryColumn(completedGroups, COL.finalCount);
  var overallConv1to5 = totalDay1 > 0 ? round1(totalFinal / totalDay1 * 100) : 0;

  var fellApartEntries = completedGroups.filter(function(e) { return e.fellApart; });
  var fellApartDay1 = sumEntryColumn(fellApartEntries, COL.day1);
  var fellApartFinal = sumEntryColumn(fellApartEntries, COL.finalCount);
  var fellApartConv1to5 = fellApartDay1 > 0 ? round1(fellApartFinal / fellApartDay1 * 100) : null;
  var fellApartShare = totalCompleted > 0 ? round1(fellApart / totalCompleted * 100) : 0;
  var leftSelfRate = totalDay1 > 0 ? round1(totalLeftSelf / totalDay1 * 100) : 0;
  var refuseRate = totalDay1 > 0 ? round1(totalRefused / totalDay1 * 100) : 0;
  var transferRate = totalDay1 > 0 ? round1(totalTransferred / totalDay1 * 100) : 0;
  var yieldPerGroup = totalCompleted > 0 ? round1(totalFinal / totalCompleted) : 0;
  var avgDay1PerGroup = totalCompleted > 0 ? round1(totalDay1 / totalCompleted) : 0;

  var rankCtx = {
    totalFinal: totalFinal,
    totalGroups: totalCompleted,
    totalDay1: totalDay1
  };
  var metricsMeta = buildMetricsMeta();
  var lineReviewPack = collectLineReviewPack(trainerList.map(function(row) { return row.name; }));
  trainerList = trainerList.map(function(row) {
    return Object.assign({}, row, {
      lineReview: lineReviewPack.byTrainer[row.name] || null,
      departed: isDepartedTrainer(row.name)
    });
  });
  rankCtx.lineAvgScore = lineReviewPack.totals && lineReviewPack.totals.avgScore != null
    ? lineReviewPack.totals.avgScore : null;
  rankCtx.skillsAvgRate = meanYesRates(lineReviewPack.totals);
  metricsMeta.lineReview = Object.assign({}, metricsMeta.lineReview, {
    ok: lineReviewPack.ok,
    error: lineReviewPack.error
  });
  trainerList = trainerList.map(function(row) {
    return enrichTrainerRow(row, rankCtx, metricsMeta);
  });
  trainerList = assignTrainerRanks(trainerList, metricsMeta);

  return {
    schemaVersion: 9,
    updatedAt: Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ss"),
    metrics: metricsMeta,
    totals: {
      groups: totalGroups,
      groupsCompleted: totalCompleted,
      groupsInProgress: totalInProgress,
      notGathered: notGathered,
      fellApart: fellApart,
      fellApartDay1: fellApartDay1,
      fellApartFinalCount: fellApartFinal,
      fellApartConv1to5: fellApartConv1to5,
      fellApartShare: fellApartShare,
      day1: totalDay1,
      day2Start: totalDay2Start,
      day3Start: totalDay3Start,
      leftSelf: totalLeftSelf,
      refused: totalRefused,
      transferred: totalTransferred,
      finalCount: totalFinal,
      conv1to5: overallConv1to5,
      leftSelfRate: leftSelfRate,
      refuseRate: refuseRate,
      transferRate: transferRate,
      yieldPerGroup: yieldPerGroup,
      avgDay1PerGroup: avgDay1PerGroup,
      lineReview: lineReviewPack.totals
    },
    funnel: [
      { label: '1-й день', value: totalDay1 },
      { label: '2-й день', value: totalDay2Start },
      { label: '3-й день', value: totalDay3Start },
      { label: 'Выход на линию', value: totalFinal }
    ],
    byTrainer: trainerList,
    byMonth: monthList,
    groups: groupList
  };
}

// ======================================================
// ЧАСТЬ 2: дашборд внутри самой таблицы (как раньше)
// ======================================================
function buildDashboard() {
  var data = collectDashboardData();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var dash = ss.getSheetByName(DASHBOARD_SHEET_NAME);
  if (dash) {
    dash.clear();
    dash.getCharts().forEach(function(c) { dash.removeChart(c); });
  } else {
    dash = ss.insertSheet(DASHBOARD_SHEET_NAME);
  }

  dash.getRange('A1').setValue('ДАШБОРД ОБУЧЕНИЯ').setFontSize(16).setFontWeight('bold');
  dash.getRange('A2').setValue('Обновлено: ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm'));

  var t = data.totals;
  var summaryRows = [
    ['Всего групп (старт, вкл. ещё в обучении)', t.groups],
    ['Закончились (D ≤ сегодня или распалась)', t.groupsCompleted != null ? t.groupsCompleted : t.groups],
    ['Ещё в обучении (не в конверсиях и выходе)', t.groupsInProgress != null ? t.groupsInProgress : 0],
    ['Групп не собралось (не в расчёте)', t.notGathered],
    ['Групп распалось (в расчёте, с меткой)', t.fellApart],
    ['Доля распавшихся от законченных', (t.fellApartShare != null ? t.fellApartShare : 0) + '%'],
    ['Конверсия 1→5 у распавшихся', t.fellApartConv1to5 != null ? t.fellApartConv1to5 + '%' : '—'],
    ['Вышло на 1-й день (закончившиеся группы)', t.day1],
    ['Ушли сами (закончившиеся группы)', t.leftSelf],
    ['Отказали мы (закончившиеся группы)', t.refused],
    ['Перенесли в другую группу (закончившиеся группы)', t.transferred],
    ['Итоговый выход на линию (закончившиеся группы)', t.finalCount],
    ['Общая конверсия 1→5 день', t.conv1to5 + '%'],
    ['Оценка после линии (журнал ОС), средняя 1–5', t.lineReview && t.lineReview.avgScore != null ? t.lineReview.avgScore : '—'],
    ['Оценок в журнале ОС (с числом 1–5)', t.lineReview && t.lineReview.scored != null ? t.lineReview.scored : '—']
  ];
  dash.getRange(4, 1, 1, 2).setValues([['Показатель', 'Значение']]).setFontWeight('bold').setBackground('#d9d9d9');
  dash.getRange(5, 1, summaryRows.length, 2).setValues(summaryRows);

  var tableStartRow = 4 + summaryRows.length + 3;
  dash.getRange(tableStartRow, 1).setValue('ПО ТРЕНЕРАМ').setFontWeight('bold').setFontSize(13);

  var trainerHeaders = ['Место', 'Тренер', 'TQI v3', 'Групп', 'Day1→Итог', 'Выход/гр', 'Вклад %', 'Распалось', 'Ушли %', 'Конв. 1→5', 'Конв. 2→5', 'Конв. 3→5', 'ОС 1–5'];
  var headerRow = tableStartRow + 1;
  dash.getRange(headerRow, 1, 1, trainerHeaders.length).setValues([trainerHeaders]).setFontWeight('bold').setBackground('#d9d9d9');

  var trainersSorted = data.byTrainer.slice().sort(function(a, b) {
    var ar = a.rank != null ? a.rank : 9999;
    var br = b.rank != null ? b.rank : 9999;
    if (ar !== br) return ar - br;
    var as = a.score != null ? a.score : -1;
    var bs = b.score != null ? b.score : -1;
    return bs - as;
  });
  var trainerRows = trainersSorted.map(function(tr) {
    return [
      tr.rank != null ? tr.rank : '',
      tr.name + (tr.departed ? ' (Уволен)' : ''),
      tr.score != null ? tr.score : '',
      tr.groups + (tr.groupsInProgress ? ' (' + tr.groupsInProgress + ' в обуч.)' : ''),
      (tr.day1 || 0) + '→' + (tr.finalCount || 0),
      tr.yieldPerGroup != null ? tr.yieldPerGroup : '',
      tr.contributionShare != null ? tr.contributionShare + '%' : '',
      tr.fellApart || 0,
      tr.leftRate != null ? tr.leftRate + '%' : '',
      tr.conv1to5Weighted !== null && tr.conv1to5Weighted !== undefined ? tr.conv1to5Weighted + '%' : '',
      tr.conv2 !== null && tr.conv2 !== undefined ? tr.conv2 + '%' : '',
      tr.conv3 !== null && tr.conv3 !== undefined ? tr.conv3 + '%' : '',
      tr.lineReview && tr.lineReview.avgScore != null ? tr.lineReview.avgScore : ''
    ];
  });
  if (trainerRows.length > 0) {
    dash.getRange(headerRow + 1, 1, trainerRows.length, trainerHeaders.length).setValues(trainerRows);
  }
  dash.autoResizeColumns(1, trainerHeaders.length);

  var chart1 = dash.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(dash.getRange(headerRow, 2, trainerRows.length + 1, 1))
    .addRange(dash.getRange(headerRow, 3, trainerRows.length + 1, 1))
    .setPosition(headerRow, trainerHeaders.length + 2, 0, 0)
    .setOption('title', 'TQI v3 по тренерам')
    .setOption('width', 600).setOption('height', 350)
    .build();
  dash.insertChart(chart1);

  dash.getRange(tableStartRow - 2, 15, 3, 2).setValues([
    ['Ушли сами', t.leftSelf], ['Отказали мы', t.refused], ['Перенесли', t.transferred]
  ]);
  var chart2 = dash.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(dash.getRange(tableStartRow - 2, 15, 3, 2))
    .setPosition(headerRow, trainerHeaders.length + 2, 20, 0)
    .setOption('title', 'Структура отсева (всего)')
    .setOption('width', 600).setOption('height', 350)
    .build();
  dash.insertChart(chart2);

  SpreadsheetApp.getUi().alert('Дашборд обновлён! Смотри лист "' + DASHBOARD_SHEET_NAME + '".');
}

// ======================================================
// ЧАСТЬ 3: веб-сервис — публикует ТОЛЬКО агрегаты как JSON
// ======================================================
function doGet(e) {
  e = e || {};
  var params = e.parameter || {};
  var forceRefresh = String(params.refresh || '') === '1' || String(params.refresh || '') === 'true';
  var cache = CacheService.getScriptCache();

  if (!forceRefresh) {
    var cached = cache.get(API_CACHE_KEY);
    if (cached) {
      try {
        var cachedData = JSON.parse(cached);
        cachedData.cache = { hit: true, ttlSec: API_CACHE_TTL_SEC };
        return ContentService
          .createTextOutput(JSON.stringify(cachedData))
          .setMimeType(ContentService.MimeType.JSON);
      } catch (ignoreParse) {
        // битый кэш — пересчитаем
      }
    }
  }

  var data;
  try {
    data = collectDashboardData();
  } catch (err) {
    // Например, переименовали заголовок обязательной колонки — отдаём понятную ошибку вместо HTML-страницы
    return ContentService
      .createTextOutput(JSON.stringify({ error: String(err && err.message ? err.message : err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  data.cache = { hit: false, ttlSec: API_CACHE_TTL_SEC };
  var json = JSON.stringify(data);
  try {
    // Script Cache ~100KB/ключ; наш payload сейчас заметно меньше
    cache.put(API_CACHE_KEY, json, API_CACHE_TTL_SEC);
  } catch (ignorePut) {
    // если не влезло — просто отдаём без кэша
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ======== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ========
function normalizeHeader(value) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/** Строка заголовков → { поле: индекс колонки листа } или null, если это не строка заголовков. */
function mapHeaderRow(row) {
  if (!/^месяц,\s*группа/.test(normalizeHeader(row[0]))) return null;
  var map = {};
  for (var c = 0; c < row.length; c++) {
    var h = normalizeHeader(row[c]);
    if (!h) continue;
    for (var p = 0; p < HEADER_PATTERNS.length; p++) {
      var key = HEADER_PATTERNS[p][0];
      if (map[key] === undefined && HEADER_PATTERNS[p][1].test(h)) { map[key] = c; break; }
    }
  }
  var missing = REQUIRED_COLUMNS.filter(function(k) { return map[k] === undefined; });
  if (missing.length) {
    throw new Error('В листе "' + SOURCE_SHEET_NAME + '" не найдены колонки: ' + missing.join(', ') +
      '. Проверь названия заголовков (docs/DataModel.md).');
  }
  return map;
}

/**
 * Читает лист и раскладывает каждую строку в канонический порядок COL по заголовкам.
 * Заголовки повторяются над каждым блоком месяца — раскладка обновляется на каждом из них.
 * Строки до первого заголовка и сами заголовки возвращаются пустыми (без даты старта → пропуск).
 */
function readSourceRows(sheet) {
  var lastRow = Math.min(Math.max(sheet.getLastRow(), DATA_START_ROW), DATA_END_ROW);
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var raw = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, lastCol).getValues();
  var map = null;
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var headerMap = mapHeaderRow(raw[i]);
    var row = new Array(COL_COUNT);
    for (var k = 0; k < COL_COUNT; k++) row[k] = '';
    if (headerMap) { map = headerMap; out.push(row); continue; }
    if (map) {
      for (var key in map) row[COL[key]] = raw[i][map[key]];
    }
    out.push(row);
  }
  if (!map) throw new Error('В листе "' + SOURCE_SHEET_NAME + '" не найдена строка заголовков «Месяц, группа».');
  return out;
}

/** Пусто ≠ 0: для новых колонок (4-й день, «на выход») у старых групп ячейки пустые → null. */
function numOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  var n = Number(value);
  return isNaN(n) ? null : n;
}

/**
 * Статус группы по колонке «Комментарий» (регистр не важен). Синонимы (ADR-021):
 *  «не собралась» / «не набралась» / «не состоялась» → вне расчёта;
 *  «распалась» / «расформирована» → в valid с меткой fellApart.
 * Всё остальное («1-ый уровень», «Force Group», «Сервисная») — тип группы, на расчёт не влияет.
 */
function groupStatusFromComment(value) {
  var c = String(value || '').toLowerCase().replace(/ё/g, 'е');
  return {
    notGathered: /не\s*(собрал|набрал|состоял)/.test(c),
    fellApart: /(распал|расформир)/.test(c)
  };
}

function normalizeName(value) {
  var name = String(value || 'Без имени');
  name = name.trim().replace(/\s+/g, ' ');
  name = name.replace(/\s*\([^)]*\)\s*/g, '').trim();
  return name;
}

function sumColumn(rows, colIndex) {
  return rows.reduce(function(sum, row) { return sum + (Number(row[colIndex]) || 0); }, 0);
}

function sumEntryColumn(entries, colIndex) {
  return entries.reduce(function(sum, entry) {
    return sum + (Number(entry.row[colIndex]) || 0);
  }, 0);
}

function formatSheetDate(value, tz) {
  if (!(value instanceof Date)) return null;
  return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
}

function isLineDateReached(lineDate, todayKey, tz) {
  if (!(lineDate instanceof Date)) return false;
  return formatSheetDate(lineDate, tz) <= todayKey;
}

function stripTrainerRolePrefix(name) {
  return String(name || '').replace(/^тренер[:.\s]+/i, '').trim();
}

function foldYo(s) {
  return String(s || '').replace(/ё/gi, 'е');
}

function trainerMatchKey(value) {
  var name = stripTrainerRolePrefix(normalizeName(value));
  if (!name || name === 'Без имени') return '';
  name = foldYo(name).toLowerCase();
  var parts = name.split(' ');
  if (parts.length >= 2) return parts[0] + '|' + parts[1];
  return name;
}

function departedTrainerKeySet() {
  var set = {};
  (DEPARTED_TRAINERS || []).forEach(function(name) {
    var key = trainerMatchKey(name);
    if (key) set[key] = true;
  });
  return set;
}

function isDepartedTrainer(name, keySet) {
  var key = trainerMatchKey(name);
  if (!key) return false;
  keySet = keySet || departedTrainerKeySet();
  return !!keySet[key];
}

function parseScore15(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (value >= 1 && value <= 5) return round1(value);
    return null;
  }
  var s = String(value).replace(/\u200b/g, '').trim();
  if (!s) return null;
  s = s.replace(',', '.');
  s = s.replace(/(\d)\.\s*[.,]?\s*(\d)/, '$1.$2');
  if (/[–—-]/.test(s)) return null;
  var m = s.match(/^([1-5](?:\.\d+)?)(?!\d)/);
  if (!m) return null;
  var n = parseFloat(m[1]);
  if (isNaN(n) || n < 1 || n > 5) return null;
  return round1(n);
}

function parseYesNo(value) {
  if (value === true) return true;
  if (value === false) return false;
  if (value === '' || value === null || value === undefined) return null;
  var s = String(value).replace(/\u200b/g, '').trim().toLowerCase();
  if (!s || s === '?' || s === '-' || s === '—' || s === '–') return null;
  if (s === 'да' || s === 'yes' || s === 'y' || s === '+') return true;
  if (s === 'нет' || s === 'no' || s === 'n') return false;
  return null;
}

function emptyLineReviewAgg() {
  return {
    reviewed: 0,
    scored: 0,
    scoreSum: 0,
    avgScore: null,
    scriptYes: 0,
    scriptFilled: 0,
    scriptYesRate: null,
    objectionsYes: 0,
    objectionsFilled: 0,
    objectionsYesRate: null,
    crmYes: 0,
    crmFilled: 0,
    crmYesRate: null
  };
}

function addLineReviewSample(agg, score, script, objections, crm) {
  agg.reviewed += 1;
  if (score !== null) {
    agg.scored += 1;
    agg.scoreSum += score;
  }
  if (script !== null) {
    agg.scriptFilled += 1;
    if (script) agg.scriptYes += 1;
  }
  if (objections !== null) {
    agg.objectionsFilled += 1;
    if (objections) agg.objectionsYes += 1;
  }
  if (crm !== null) {
    agg.crmFilled += 1;
    if (crm) agg.crmYes += 1;
  }
}

function finalizeLineReviewAgg(agg) {
  var out = {
    reviewed: agg.reviewed,
    scored: agg.scored,
    avgScore: agg.scored > 0 ? round1(agg.scoreSum / agg.scored) : null,
    scriptYesRate: agg.scriptFilled > 0 ? round1(agg.scriptYes / agg.scriptFilled * 100) : null,
    scriptFilled: agg.scriptFilled,
    objectionsYesRate: agg.objectionsFilled > 0 ? round1(agg.objectionsYes / agg.objectionsFilled * 100) : null,
    objectionsFilled: agg.objectionsFilled,
    crmYesRate: agg.crmFilled > 0 ? round1(agg.crmYes / agg.crmFilled * 100) : null,
    crmFilled: agg.crmFilled
  };
  return out;
}

function isLineReviewDataRow(row) {
  var employee = String(row[LINE_COL.employee] || '').replace(/\u200b/g, '').trim();
  var trainerRaw = String(row[LINE_COL.trainer] || '').replace(/\u200b/g, '').trim();
  if (!employee && !trainerRaw) return false;
  var empLow = employee.toLowerCase();
  if (empLow === 'сотрудник' || empLow.indexOf('дата старта') === 0 || empLow.indexOf('дата выхода') === 0) return false;
  if (empLow === 'да/нет') return false;
  var trLow = trainerRaw.toLowerCase();
  if (trLow === 'тренер:' || trLow === 'тренер' || trLow === 'да/нет') return false;
  return true;
}

function collectLineReviewPack(canonicalNames) {
  var emptyTotals = Object.assign(finalizeLineReviewAgg(emptyLineReviewAgg()), {
    unmatched: 0,
    skipped: 0
  });
  var fail = function(message) {
    return { ok: false, error: message, byTrainer: {}, totals: emptyTotals };
  };
  try {
    if (!LINE_REVIEW_SPREADSHEET_ID) return fail('не задан LINE_REVIEW_SPREADSHEET_ID');
    var book = SpreadsheetApp.openById(LINE_REVIEW_SPREADSHEET_ID);
    var sheet = book.getSheetByName(LINE_REVIEW_SHEET_NAME);
    if (!sheet) return fail('не найден лист «' + LINE_REVIEW_SHEET_NAME + '»');

    var lastRow = Math.max(sheet.getLastRow(), 1);
    var endRow = Math.min(lastRow, LINE_REVIEW_DATA_END_ROW);
    var values = sheet.getRange('A1:' + LINE_REVIEW_LAST_COLUMN + endRow).getValues();

    var keyToName = {};
    (canonicalNames || []).forEach(function(name) {
      var key = trainerMatchKey(name);
      if (key) keyToName[key] = name;
    });

    var byKey = {};
    var company = emptyLineReviewAgg();
    var unmatched = 0;
    var skipped = 0;

    values.forEach(function(row) {
      if (!isLineReviewDataRow(row)) return;
      var trainerRaw = String(row[LINE_COL.trainer] || '').replace(/\u200b/g, '').trim();
      var key = trainerMatchKey(trainerRaw);
      if (!key) {
        skipped += 1;
        return;
      }
      var canonical = keyToName[key];
      if (!canonical) {
        unmatched += 1;
        return;
      }
      if (!byKey[canonical]) byKey[canonical] = emptyLineReviewAgg();
      var score = parseScore15(row[LINE_COL.score]);
      var script = parseYesNo(row[LINE_COL.script]);
      var objections = parseYesNo(row[LINE_COL.objections]);
      var crm = parseYesNo(row[LINE_COL.crm]);
      addLineReviewSample(byKey[canonical], score, script, objections, crm);
      addLineReviewSample(company, score, script, objections, crm);
    });

    var byTrainer = {};
    Object.keys(byKey).forEach(function(name) {
      byTrainer[name] = finalizeLineReviewAgg(byKey[name]);
    });
    var totals = Object.assign(finalizeLineReviewAgg(company), {
      unmatched: unmatched,
      skipped: skipped
    });
    return { ok: true, error: null, byTrainer: byTrainer, totals: totals };
  } catch (err) {
    var msg = err && err.message ? String(err.message) : String(err);
    if (/permission|authorize|access|недостаточно|denied/i.test(msg)) {
      msg = 'нет доступа к журналу ОС — выдай «Читатель» аккаунту деплоера';
    }
    return fail(msg);
  }
}

function outcomeGroupCount(row) {
  if (row && row.groupsCompleted != null) return Number(row.groupsCompleted) || 0;
  return Number(row && row.groups) || 0;
}

function parsePercent(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  var num = parseFloat(String(value).replace('%', '').replace(',', '.'));
  return isNaN(num) ? null : num / 100;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function clamp100(n) {
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function buildMetricsMeta() {
  return {
    conv1to5Totals: 'weighted',
    conv1to5ByTrainer: 'avgGroups',
    conv1to5ByMonth: 'weighted',
    fellApartInValid: true,
    rankScore: 'tqi_v3',
    rankMinGroups: 2,
    rankMinDay1: 10,
    rankMinLineScores: 2,
    outcomeFromCompleted: true,
    completedRule: 'lineDate<=today || fellApart',
    rankWeights: {
      quality: 0.40,
      line: 0.05,
      skills: 0.05,
      reliability: 0.15,
      contribution: 0.20,
      yield: 0.10,
      stability: 0.05
    },
    qualityMix: { conv1to5: 0.60, conv2: 0.25, conv3: 0.15 },
    contribFullAtShare: 0.25,
    reliabilityRefDay1: 200,
    badgeLow: 20,
    badgeHigh: 30,
    planConv1to5: 30,
    lineReview: {
      periodIndependent: true,
      scoreMin: 1,
      scoreMax: 5,
      badgeLow: 3.5,
      badgeHigh: 4.5
    },
    departedTrainers: (DEPARTED_TRAINERS || []).slice()
  };
}

function enrichTrainerRow(row, ctx, metricsMeta) {
  var day1 = Number(row.day1) || 0;
  var groupsOutcome = outcomeGroupCount(row);
  var finalCount = Number(row.finalCount) || 0;
  var leftRate = day1 > 0 ? round1((Number(row.leftSelf) || 0) / day1 * 100) : null;
  var refuseRate = day1 > 0 ? round1((Number(row.refused) || 0) / day1 * 100) : null;
  var transferRate = day1 > 0 ? round1((Number(row.transferred) || 0) / day1 * 100) : null;
  var fellShare = groupsOutcome > 0 ? round1((Number(row.fellApart) || 0) / groupsOutcome * 100) : 0;
  var yieldPerGroup = groupsOutcome > 0 ? round1(finalCount / groupsOutcome) : null;
  var totalFinal = ctx && ctx.totalFinal ? ctx.totalFinal : 0;
  var contributionShare = totalFinal > 0 ? round1(finalCount / totalFinal * 100) : 0;
  var scored = computeTrainerScore(row, metricsMeta, ctx);
  return Object.assign({}, row, {
    leftRate: leftRate,
    refuseRate: refuseRate,
    transferRate: transferRate,
    fellShare: fellShare,
    yieldPerGroup: yieldPerGroup,
    contributionShare: contributionShare,
    score: scored ? scored.score : null,
    scoreParts: scored ? scored.parts : null
  });
}

function assignTrainerRanks(list, metricsMeta) {
  var minG = metricsMeta.rankMinGroups || 2;
  var minD = metricsMeta.rankMinDay1 || 10;
  var eligible = list.filter(function(t) {
    return t.score != null && outcomeGroupCount(t) >= minG && (t.day1 || 0) >= minD;
  }).slice().sort(function(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return (b.finalCount || 0) - (a.finalCount || 0);
  });
  var rankByName = {};
  eligible.forEach(function(t, i) { rankByName[t.name] = i + 1; });
  return list.map(function(t) {
    return Object.assign({}, t, {
      rank: rankByName[t.name] != null ? rankByName[t.name] : null,
      rankEligible: !!rankByName[t.name]
    });
  }).sort(function(a, b) {
    if (a.rank != null && b.rank != null) return a.rank - b.rank;
    if (a.rank != null) return -1;
    if (b.rank != null) return 1;
    var as = a.score != null ? a.score : -1;
    var bs = b.score != null ? b.score : -1;
    return bs - as;
  });
}

/**
 * TQI v3 — воронка + оценка после линии + вклад (0–100). См. ADR-016.
 */
function meanYesRates(obj) {
  if (!obj) return null;
  var xs = [];
  if (obj.scriptYesRate != null) xs.push(Number(obj.scriptYesRate));
  if (obj.objectionsYesRate != null) xs.push(Number(obj.objectionsYesRate));
  if (obj.crmYesRate != null) xs.push(Number(obj.crmYesRate));
  if (!xs.length) return null;
  var s = 0;
  for (var i = 0; i < xs.length; i++) s += xs[i];
  return round1(s / xs.length);
}

function skillsFilledCount(obj) {
  if (!obj) return 0;
  return (Number(obj.scriptFilled) || 0) + (Number(obj.objectionsFilled) || 0) + (Number(obj.crmFilled) || 0);
}

function lineQualityPart(t, metricsMeta, ctx) {
  var minN = metricsMeta && metricsMeta.rankMinLineScores != null ? metricsMeta.rankMinLineScores : 2;
  var lr = t && t.lineReview;
  var personal = !!(lr && lr.avgScore != null && (Number(lr.scored) || 0) >= minN);
  var raw = personal ? lr.avgScore : (ctx && ctx.lineAvgScore != null ? ctx.lineAvgScore : null);
  if (raw == null) return { value: 60, fill: 'neutral' };
  return { value: clamp100(raw / 5 * 100), fill: personal ? 'personal' : 'company' };
}

function skillsQualityPart(t, metricsMeta, ctx) {
  var minN = metricsMeta && metricsMeta.rankMinLineScores != null ? metricsMeta.rankMinLineScores : 2;
  var lr = t && t.lineReview;
  var personalRate = meanYesRates(lr);
  var personal = !!(personalRate != null && skillsFilledCount(lr) >= minN);
  var raw = personal ? personalRate : (ctx && ctx.skillsAvgRate != null ? ctx.skillsAvgRate : null);
  if (raw == null) return { value: 80, fill: 'neutral' };
  return { value: clamp100(raw), fill: personal ? 'personal' : 'company' };
}

function computeTrainerScore(t, metricsMeta, ctx) {
  var c15 = t.conv1to5Weighted;
  if (c15 === null || c15 === undefined) return null;
  metricsMeta = metricsMeta || buildMetricsMeta();
  ctx = ctx || {};
  var w = metricsMeta.rankWeights || {};
  var qm = metricsMeta.qualityMix || { conv1to5: 0.60, conv2: 0.25, conv3: 0.15 };
  var c2 = (t.conv2 !== null && t.conv2 !== undefined) ? t.conv2 : c15;
  var c3 = (t.conv3 !== null && t.conv3 !== undefined) ? t.conv3 : c15;
  var quality = clamp100(
    (qm.conv1to5 || 0) * c15 +
    (qm.conv2 || 0) * c2 +
    (qm.conv3 || 0) * c3
  );

  var refDay1 = metricsMeta.reliabilityRefDay1 || 200;
  var reliability = clamp100(
    (Math.log((Number(t.day1) || 0) + 1) / Math.log(refDay1 + 1)) * 100
  );

  var totalFinal = Number(ctx.totalFinal) || 0;
  var share = totalFinal > 0 ? (Number(t.finalCount) || 0) / totalFinal : 0;
  var fullAt = metricsMeta.contribFullAtShare || 0.25;
  var contribution = fullAt > 0 ? clamp100(share / fullAt * 100) : 0;

  var totalGroups = Number(ctx.totalGroups) || 0;
  var groupsOutcome = outcomeGroupCount(t);
  var avgYield = totalGroups > 0 ? totalFinal / totalGroups : 0;
  var yieldG = groupsOutcome > 0 ? (Number(t.finalCount) || 0) / groupsOutcome : 0;
  var yieldScore = avgYield > 0 ? clamp100((yieldG / avgYield) * 50) : 50;

  var fellShare = groupsOutcome > 0
    ? (Number(t.fellApart) || 0) / groupsOutcome * 100 : 0;
  var stability = clamp100(100 - fellShare);

  var linePart = lineQualityPart(t, metricsMeta, ctx);
  var skillsPart = skillsQualityPart(t, metricsMeta, ctx);
  var lineW = w.line != null ? w.line : 0;
  var skillsW = w.skills != null ? w.skills : 0;

  var score =
    (w.quality || 0) * quality +
    lineW * linePart.value +
    skillsW * skillsPart.value +
    (w.reliability || 0) * reliability +
    (w.contribution || 0) * contribution +
    (w.yield || 0) * yieldScore +
    (w.stability || 0) * stability;

  return {
    score: round1(score),
    parts: {
      quality: round1(quality),
      line: round1(linePart.value),
      lineFill: linePart.fill,
      skills: round1(skillsPart.value),
      skillsFill: skillsPart.fill,
      reliability: round1(reliability),
      contribution: round1(contribution),
      yield: round1(yieldScore),
      stability: round1(stability)
    }
  };
}