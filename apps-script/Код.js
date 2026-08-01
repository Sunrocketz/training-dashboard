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
var LAST_COLUMN = 'R';    // последняя колонка с данными
var API_CACHE_KEY = 'dashboard_json_v3';
var API_CACHE_TTL_SEC = 300; // 5 минут — повторные открытия дашборда без пересчёта листа
// =================================================================

var COL = {
  monthGroup: 0, trainer: 1, startDate: 2, lineDate: 3, day1: 4,
  leftSelf: 5, leftSelfPct: 6, refused: 7, refusedPct: 8,
  transferred: 9, transferredPct: 10, day2Start: 11, conv2: 12,
  finalCount: 13, conv1to5: 14, day3Start: 15, conv3: 16, comment: 17
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

  var lastRow = Math.max(sourceSheet.getLastRow(), DATA_START_ROW);
  var endRow = Math.min(lastRow, DATA_END_ROW);
  var range = sourceSheet.getRange('A' + DATA_START_ROW + ':' + LAST_COLUMN + endRow);
  var values = range.getValues();

  // validEntry = { row, fellApart }; «не собралась» исключаем, «распалась» — в valid с меткой
  var validGroups = [];
  var notGathered = 0;
  var fellApart = 0;

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var startDate = row[COL.startDate];
    if (!(startDate instanceof Date)) continue;

    var comment = String(row[COL.comment] || '').toLowerCase();
    if (comment.indexOf('не собралась') !== -1) {
      notGathered++;
      continue;
    }
    var isFellApart = comment.indexOf('распалась') !== -1;
    if (isFellApart) fellApart++;
    validGroups.push({ row: row, fellApart: isFellApart });
  }

  // ---- по тренерам ----
  var byTrainer = {};
  validGroups.forEach(function(entry) {
    var row = entry.row;
    var trainer = normalizeName(row[COL.trainer]);
    if (!byTrainer[trainer]) {
      byTrainer[trainer] = {
        name: trainer, groups: 0, fellApart: 0, day1Total: 0, leftSelf: 0, refused: 0,
        transferred: 0, finalCount: 0, fellApartDay1: 0, fellApartFinal: 0,
        conv1to5Sum: 0, conv2Sum: 0, conv3Sum: 0,
        conv2Count: 0, conv3Count: 0
      };
    }
    var t = byTrainer[trainer];
    t.groups += 1;
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

  var trainerList = Object.keys(byTrainer).sort().map(function(name) {
    var t = byTrainer[name];
    return {
      name: t.name,
      groups: t.groups,
      fellApart: t.fellApart,
      day1: t.day1Total,
      leftSelf: t.leftSelf,
      refused: t.refused,
      transferred: t.transferred,
      finalCount: t.finalCount,
      // среднее % по группам (историческое поле)
      conv1to5: t.groups > 0 ? round1(t.conv1to5Sum / t.groups * 100) : null,
      // взвешенная конверсия: сумма final / сумма day1 (как totals.conv1to5)
      conv1to5Weighted: t.day1Total > 0 ? round1(t.finalCount / t.day1Total * 100) : null,
      fellApartConv1to5: t.fellApartDay1 > 0 ? round1(t.fellApartFinal / t.fellApartDay1 * 100) : null,
      conv2: t.conv2Count > 0 ? round1(t.conv2Sum / t.conv2Count * 100) : null,
      conv3: t.conv3Count > 0 ? round1(t.conv3Sum / t.conv3Count * 100) : null
    };
  });

  // ---- по месяцам (для тренда + отсев) ----
  var byMonth = {};
  var monthOrder = [];
  validGroups.forEach(function(entry) {
    var row = entry.row;
    var label = String(row[COL.monthGroup] || '');
    var month = label.split(',')[0].trim() || 'Без месяца';
    if (!byMonth[month]) {
      byMonth[month] = {
        month: month, groups: 0, fellApart: 0, day1Total: 0, finalCount: 0,
        leftSelf: 0, refused: 0, transferred: 0,
        fellApartDay1: 0, fellApartFinal: 0
      };
      monthOrder.push(month);
    }
    byMonth[month].groups += 1;
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

  var groupList = validGroups.map(function(entry) {
    var row = entry.row;
    var label = String(row[COL.monthGroup] || '');
    var month = label.split(',')[0].trim() || 'Без месяца';
    return {
      label: label,
      month: month,
      trainer: normalizeName(row[COL.trainer]),
      startDate: row[COL.startDate] instanceof Date
        ? Utilities.formatDate(row[COL.startDate], Session.getScriptTimeZone(), 'yyyy-MM-dd') : null,
      fellApart: !!entry.fellApart,
      day1: Number(row[COL.day1]) || 0,
      leftSelf: Number(row[COL.leftSelf]) || 0,
      refused: Number(row[COL.refused]) || 0,
      transferred: Number(row[COL.transferred]) || 0,
      day2Start: Number(row[COL.day2Start]) || 0,
      day3Start: Number(row[COL.day3Start]) || 0,
      finalCount: Number(row[COL.finalCount]) || 0,
      conv1to5: (function(){ var v = parsePercent(row[COL.conv1to5]); return v !== null ? round1(v*100) : null; })(),
      conv2: (function(){ var v = parsePercent(row[COL.conv2]); return v !== null ? round1(v*100) : null; })(),
      conv3: (function(){ var v = parsePercent(row[COL.conv3]); return v !== null ? round1(v*100) : null; })()
    };
  });

  // ---- общие итоги ----
  var totalGroups = validGroups.length;
  var totalDay1 = sumEntryColumn(validGroups, COL.day1);
  var totalDay2Start = sumEntryColumn(validGroups, COL.day2Start);
  var totalDay3Start = sumEntryColumn(validGroups, COL.day3Start);
  var totalLeftSelf = sumEntryColumn(validGroups, COL.leftSelf);
  var totalRefused = sumEntryColumn(validGroups, COL.refused);
  var totalTransferred = sumEntryColumn(validGroups, COL.transferred);
  var totalFinal = sumEntryColumn(validGroups, COL.finalCount);
  var overallConv1to5 = totalDay1 > 0 ? round1(totalFinal / totalDay1 * 100) : 0;

  var fellApartEntries = validGroups.filter(function(e) { return e.fellApart; });
  var fellApartDay1 = sumEntryColumn(fellApartEntries, COL.day1);
  var fellApartFinal = sumEntryColumn(fellApartEntries, COL.finalCount);
  var fellApartConv1to5 = fellApartDay1 > 0 ? round1(fellApartFinal / fellApartDay1 * 100) : null;
  var fellApartShare = totalGroups > 0 ? round1(fellApart / totalGroups * 100) : 0;

  return {
    schemaVersion: 3,
    updatedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss"),
    metrics: {
      conv1to5Totals: 'weighted',      // finalSum / day1Sum
      conv1to5ByTrainer: 'avgGroups',  // среднее % групп; см. также conv1to5Weighted
      conv1to5ByMonth: 'weighted',
      fellApartInValid: true,          // «распалась» входит в valid + метка
      badgeLow: 20,
      badgeHigh: 30,
      planConv1to5: 30
    },
    totals: {
      groups: totalGroups,
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
      conv1to5: overallConv1to5
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
    ['Всего групп (учтено в конверсиях, вкл. распавшиеся)', t.groups],
    ['Групп не собралось (не в расчёте)', t.notGathered],
    ['Групп распалось (в расчёте, с меткой)', t.fellApart],
    ['Доля распавшихся от учтённых', (t.fellApartShare != null ? t.fellApartShare : 0) + '%'],
    ['Конверсия 1→5 у распавшихся', t.fellApartConv1to5 != null ? t.fellApartConv1to5 + '%' : '—'],
    ['Вышло на 1-й день (всего)', t.day1],
    ['Ушли сами (всего)', t.leftSelf],
    ['Отказали мы (всего)', t.refused],
    ['Перенесли в другую группу (всего)', t.transferred],
    ['Итоговый выход на линию (всего)', t.finalCount],
    ['Общая конверсия 1→5 день', t.conv1to5 + '%']
  ];
  dash.getRange(4, 1, 1, 2).setValues([['Показатель', 'Значение']]).setFontWeight('bold').setBackground('#d9d9d9');
  dash.getRange(5, 1, summaryRows.length, 2).setValues(summaryRows);

  var tableStartRow = 4 + summaryRows.length + 3;
  dash.getRange(tableStartRow, 1).setValue('ПО ТРЕНЕРАМ').setFontWeight('bold').setFontSize(13);

  var trainerHeaders = ['Тренер', 'Групп', 'Распалось', 'Вышло 1 день', 'Ушли сами', 'Отказали мы', 'Перенесли', 'Итог выход', 'Конв. 1→5', 'Конв. 2→5', 'Конв. 3→5'];
  var headerRow = tableStartRow + 1;
  dash.getRange(headerRow, 1, 1, trainerHeaders.length).setValues([trainerHeaders]).setFontWeight('bold').setBackground('#d9d9d9');

  var trainerRows = data.byTrainer.map(function(tr) {
    return [tr.name, tr.groups, tr.fellApart || 0, tr.day1, tr.leftSelf, tr.refused, tr.transferred, tr.finalCount,
      tr.conv1to5 !== null ? tr.conv1to5 + '%' : '',
      tr.conv2 !== null ? tr.conv2 + '%' : '',
      tr.conv3 !== null ? tr.conv3 + '%' : ''];
  });
  if (trainerRows.length > 0) {
    dash.getRange(headerRow + 1, 1, trainerRows.length, trainerHeaders.length).setValues(trainerRows);
  }
  dash.autoResizeColumns(1, trainerHeaders.length);

  var chart1 = dash.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(dash.getRange(headerRow, 1, trainerRows.length + 1, 1))
    .addRange(dash.getRange(headerRow, 8, trainerRows.length + 1, 1))
    .setPosition(headerRow, trainerHeaders.length + 2, 0, 0)
    .setOption('title', 'Итоговый выход на линию по тренерам')
    .setOption('width', 600).setOption('height', 350)
    .build();
  dash.insertChart(chart1);

  dash.getRange(tableStartRow - 2, 13, 3, 2).setValues([
    ['Ушли сами', t.leftSelf], ['Отказали мы', t.refused], ['Перенесли', t.transferred]
  ]);
  var chart2 = dash.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(dash.getRange(tableStartRow - 2, 13, 3, 2))
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

  var data = collectDashboardData();
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

function parsePercent(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  var num = parseFloat(String(value).replace('%', '').replace(',', '.'));
  return isNaN(num) ? null : num / 100;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}