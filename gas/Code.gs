// KOZENI の読み書き窓口。スプシ「KOZENI__DB用」に紐づけて、ウェブアプリとして公開する。
// リクエストは text/plain の POST で {action, token, data} の JSON を受け取る。

const TZ = 'Asia/Tokyo';
const MAX_BATCH = 100;
const FIXED_CATEGORY = '固定費';
const TREND_MONTHS = 6;
const SUMMARY_MONTHS = 24;
const SUMMARY_HEADER_ROW = 4;

const ACTIONS = {
  add: add_,
  addBatch: addBatch_,
  state: state_,
  month: month_,
  update: update_,
  delete: delete_,
};

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad_json' });
  }

  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token || req.token !== token) return json_({ ok: false, error: 'unauthorized' });

  const handler = ACTIONS[req.action];
  if (!handler) return json_({ ok: false, error: 'unknown_action' });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return json_({ ok: false, error: 'busy' });
  try {
    return json_({ ok: true, data: handler(req.data || {}) });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

// 公開できたかをブラウザで開いて確かめる用。データは返さない。
function doGet() {
  return json_({ ok: true, app: 'kozeni' });
}

// ---------- エディタから実行する関数 ----------

// 合言葉を作ってスクリプトプロパティに保存し、ログに出す。エディタから1回だけ実行する。
// もう一度実行すると合言葉が変わり、端末側の設定も入れ直しになる。
function setupToken() {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('TOKEN', token);
  Logger.log(token);
}

// Phase 3 の準備。何度実行してもよい（カテゴリを増やしたときも実行し直す）。
// expenses に memo 列を足し、summary に月ごとの表を作り、固定費の月次トリガーを入れ直す。
// 開始月に入っていれば、今月の固定費もこの場で計上する。
function setupPhase3() {
  ensureMemoColumn_();
  setupSummary_();
  setupFixedCostTrigger_();
  const added = addFixedCosts();
  Logger.log('固定費を計上: ' + added.length + '件');
}

// 毎月1日0時台にトリガーから呼ばれる。手で実行してもよい（同じ月の固定費は二重にならない）。
function addFixedCosts() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('busy');
  try {
    const month = nowMonth_();
    const start = summarySettings_().startMonth;
    if (!start || month < start) {
      Logger.log('開始月（' + start + '）より前なので固定費は計上しない: ' + month);
      return [];
    }
    return upsertEntries_(fixedEntriesFor_(month));
  } finally {
    lock.releaseLock();
  }
}

// ---------- 窓口 ----------

function add_(d) {
  const error = validate_(d, activeCategories_());
  if (error) throw new Error(error);
  const r = upsertEntries_([d])[0];
  return { id: r.id, updated: r.updated };
}

// 端末の未送信キューをまとめて受け取る。1件ずつ結果を返し、不正な1件で残りを止めない。
function addBatch_(d) {
  if (!Array.isArray(d.entries) || d.entries.length === 0 || d.entries.length > MAX_BATCH) {
    throw new Error('invalid_entries');
  }
  const categories = activeCategories_();
  const checked = d.entries.map((e) => ({ entry: e, error: validate_(e, categories) }));
  const saved = upsertEntries_(checked.filter((c) => !c.error).map((c) => c.entry));
  let k = 0;
  const results = checked.map((c) => (c.error ? { id: c.entry && c.entry.id, ok: false, error: c.error } : saved[k++]));
  return { results: results, state: state_() };
}

// 入力画面に要るものだけ返す：使えるカテゴリと、今月（東京時間）の支出合計（固定費を含む）。
function state_() {
  const month = nowMonth_();
  const spent = readExpenses_()
    .filter((e) => e.month === month)
    .reduce((sum, e) => sum + e.amount, 0);
  return { categories: activeCategories_(), month: month, spent: spent };
}

// 履歴とまとめ画面用：指定した月の明細・集計と、残高の計算に要る数字。
function month_(d) {
  const month = d.month || nowMonth_();
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('invalid_month');

  const settings = summarySettings_();
  const expenses = readExpenses_();
  const incomes = readIncomes_();
  const categories = activeCategories_();

  const spentOf = {};
  const fixedOf = {};
  expenses.forEach((e) => {
    spentOf[e.month] = (spentOf[e.month] || 0) + e.amount;
    if (e.category === FIXED_CATEGORY) fixedOf[e.month] = (fixedOf[e.month] || 0) + e.amount;
  });
  const incomeOf = {};
  incomes.forEach((i) => { incomeOf[i.month] = (incomeOf[i.month] || 0) + i.amount; });

  // 残高 = 繰越 + 収入 − 支出。繰越は開始月が初期繰越、以降は前月の残高（summary シートの数式と同じ）。
  let carryover = null;
  let balance = null;
  if (settings.startMonth && month >= settings.startMonth) {
    let bal = settings.carryover;
    for (let m = settings.startMonth; m < month; m = addMonths_(m, 1)) {
      bal += (incomeOf[m] || 0) - (spentOf[m] || 0);
    }
    carryover = bal;
    balance = bal + (incomeOf[month] || 0) - (spentOf[month] || 0);
  }

  const inMonth = expenses.filter((e) => e.month === month).sort((a, b) => b.date - a.date);
  const byName = {};
  inMonth.forEach((e) => {
    if (e.category === FIXED_CATEGORY) return;
    byName[e.category] = byName[e.category] || { name: e.category, amount: 0, count: 0 };
    byName[e.category].amount += e.amount;
    byName[e.category].count += 1;
  });

  const trend = [];
  for (let i = TREND_MONTHS - 1; i >= 0; i--) {
    const m = addMonths_(month, -i);
    const totals = {};
    expenses.forEach((e) => {
      if (e.month === m && e.category !== FIXED_CATEGORY) totals[e.category] = (totals[e.category] || 0) + e.amount;
    });
    trend.push({ month: m, byCategory: totals });
  }

  const spent = spentOf[month] || 0;
  const fixed = fixedOf[month] || 0;
  return {
    month: month,
    startMonth: settings.startMonth,
    carryover: carryover,
    income: incomeOf[month] || 0,
    incomes: incomes.filter((i) => i.month === month).map((i) => ({ name: i.name, amount: i.amount })),
    spent: spent,
    fixed: fixed,
    variable: spent - fixed,
    balance: balance,
    categories: categories,
    byCategory: Object.keys(byName).map((k) => byName[k]),
    entries: inMonth.map((e) => ({
      id: e.id, date: e.date.toISOString(), amount: e.amount, category: e.category, memo: e.memo,
    })),
    trend: trend,
  };
}

// 履歴からの修正。送られてきた項目だけ変える。
function update_(d) {
  if (typeof d.id !== 'string' || d.id === '') throw new Error('invalid_id');
  const sh = sheet_('expenses');
  const values = sh.getDataRange().getValues();
  const col = columns_(values[0], ['id', 'date', 'amount', 'category']);
  const i = findRow_(values, col.id, d.id);
  if (i === -1) throw new Error('not_found');

  const row = values[i].slice();
  const current = String(row[col.category]);
  const next = {
    id: d.id,
    date: d.date !== undefined ? d.date : row[col.date],
    amount: d.amount !== undefined ? d.amount : row[col.amount],
    category: d.category !== undefined ? d.category : current,
  };
  // 固定費と、使わなくしたカテゴリのままの記録も、金額や日付だけなら直せるようにする
  const allowed = activeCategories_().concat([FIXED_CATEGORY, current]);
  const error = validate_(next, allowed);
  if (error) throw new Error(error);

  row[col.date] = new Date(next.date);
  row[col.amount] = next.amount;
  row[col.category] = next.category;
  sh.getRange(i + 1, 1, 1, row.length).setValues([row]);
  return { id: d.id, state: state_() };
}

// 履歴からの削除。もう無い id でもエラーにしない（二度押し・送り直し対策）。
function delete_(d) {
  if (typeof d.id !== 'string' || d.id === '') throw new Error('invalid_id');
  const sh = sheet_('expenses');
  const values = sh.getDataRange().getValues();
  const col = columns_(values[0], ['id']);
  const i = findRow_(values, col.id, d.id);
  if (i !== -1) sh.deleteRow(i + 1);
  return { id: d.id, deleted: i !== -1, state: state_() };
}

// ---------- 書き込み ----------

// 同じ id がすでにあれば上書きする。送り直しても行が増えない。
// 見出しにない列（あとで足した列など）は、上書きのときも元の値を残す。検証は呼ぶ側で済ませる。
function upsertEntries_(entries) {
  if (entries.length === 0) return [];
  const sh = sheet_('expenses');
  const values = sh.getDataRange().getValues();
  const width = values[0].length;
  const col = columns_(values[0], ['id', 'date', 'amount', 'category']);
  const memoCol = values[0].indexOf('memo');

  const existing = {};
  for (let i = 1; i < values.length; i++) existing[String(values[i][col.id])] = i;
  const appended = [];
  const pending = {};

  const results = entries.map((d) => {
    const base = existing[d.id] !== undefined ? values[existing[d.id]].slice() : new Array(width).fill('');
    base[col.id] = d.id;
    base[col.date] = new Date(d.date);
    base[col.amount] = d.amount;
    base[col.category] = d.category;
    if (memoCol !== -1 && d.memo !== undefined) base[memoCol] = d.memo;

    if (pending[d.id] !== undefined) {
      appended[pending[d.id]] = base;
      return { id: d.id, ok: true, updated: true };
    }
    if (existing[d.id] !== undefined) {
      sh.getRange(existing[d.id] + 1, 1, 1, width).setValues([base]);
      return { id: d.id, ok: true, updated: true };
    }
    pending[d.id] = appended.push(base) - 1;
    return { id: d.id, ok: true, updated: false };
  });

  if (appended.length) sh.getRange(values.length + 1, 1, appended.length, width).setValues(appended);
  return results;
}

// id を「fixed:月:名前」にして、同じ月に何度実行しても1件ずつにする。日付はその月の1日0時（東京）。
function fixedEntriesFor_(month) {
  const values = sheet_('fixed_costs').getDataRange().getValues();
  const col = columns_(values[0], ['name', 'amount', 'active']);
  const date = new Date(month + '-01T00:00:00+09:00');
  return values
    .slice(1)
    .filter((r) => r[col.active] === true && String(r[col.name]) !== '' && Number(r[col.amount]) > 0)
    .map((r) => ({
      id: 'fixed:' + month + ':' + r[col.name],
      date: date,
      amount: Math.round(Number(r[col.amount])),
      category: FIXED_CATEGORY,
      memo: String(r[col.name]),
    }));
}

function validate_(d, categories) {
  if (!d || typeof d.id !== 'string' || d.id === '') return 'invalid_id';
  if (!Number.isInteger(d.amount) || d.amount <= 0 || d.amount >= 10000000) return 'invalid_amount';
  if (d.date === null || d.date === '' || isNaN(new Date(d.date).getTime())) return 'invalid_date';
  if (categories.indexOf(d.category) === -1) return 'unknown_category';
  return null;
}

// ---------- 読み取り ----------

function readExpenses_() {
  const values = sheet_('expenses').getDataRange().getValues();
  const col = columns_(values[0], ['id', 'date', 'amount', 'category']);
  const memoCol = values[0].indexOf('memo');
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!isDate_(r[col.date]) || String(r[col.id]) === '') continue;
    out.push({
      id: String(r[col.id]),
      date: r[col.date],
      month: Utilities.formatDate(r[col.date], TZ, 'yyyy-MM'),
      amount: Number(r[col.amount]) || 0,
      category: String(r[col.category]),
      memo: memoCol === -1 ? '' : String(r[memoCol]),
    });
  }
  return out;
}

function readIncomes_() {
  const values = sheet_('incomes').getDataRange().getValues();
  const col = columns_(values[0], ['month', 'name', 'amount']);
  return values
    .slice(1)
    .map((r) => ({ month: monthText_(r[col.month]), name: String(r[col.name]), amount: Number(r[col.amount]) || 0 }))
    .filter((r) => r.month !== '' && r.amount !== 0);
}

// summary の A 列の見出し（初期繰越・開始月）を探して、隣の B 列の値を読む。
function summarySettings_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('summary');
  const settings = { carryover: 0, startMonth: null };
  if (!sh) return settings;
  const values = sh.getDataRange().getValues();
  for (let i = 0; i < Math.min(values.length, SUMMARY_HEADER_ROW - 1); i++) {
    const label = String(values[i][0]);
    if (label === '初期繰越') settings.carryover = Number(values[i][1]) || 0;
    if (label === '開始月') settings.startMonth = monthText_(values[i][1]) || null;
  }
  return settings;
}

function activeCategories_() {
  const values = sheet_('categories').getDataRange().getValues();
  const col = columns_(values[0], ['name', 'order', 'active']);
  return values
    .slice(1)
    .filter((r) => r[col.active] === true && r[col.name] !== '')
    .sort((a, b) => a[col.order] - b[col.order])
    .map((r) => String(r[col.name]));
}

// ---------- 準備（setupPhase3 から呼ぶ） ----------

function ensureMemoColumn_() {
  const sh = sheet_('expenses');
  const header = sh.getDataRange().getValues()[0];
  if (header.indexOf('memo') === -1) sh.getRange(1, header.length + 1, 1, 1).setValues([['memo']]);
}

// summary の4行目から下を作り直す。1〜3行目（初期繰越・開始月）は残す。
function setupSummary_() {
  const sh = sheet_('summary');
  let start = summarySettings_().startMonth;
  if (!start) {
    start = addMonths_(nowMonth_(), 1);
    sh.getRange(2, 1, 1, 2).setNumberFormat('@').setValues([['開始月', start]]);
  }

  const categories = activeCategories_();
  const headers = ['月', '収入', '支出', '固定費', '変動費', '繰越', '残高'].concat(categories);
  const clearRows = Math.max(sh.getMaxRows() - SUMMARY_HEADER_ROW + 1, 1);
  sh.getRange(SUMMARY_HEADER_ROW, 1, clearRows, sh.getMaxColumns()).clearContent();
  sh.getRange(SUMMARY_HEADER_ROW, 1, 1, headers.length).setValues([headers]);

  const first = SUMMARY_HEADER_ROW + 1;
  const months = [];
  const formulas = [];
  for (let i = 0; i < SUMMARY_MONTHS; i++) {
    const r = first + i;
    months.push([addMonths_(start, i)]);
    formulas.push(summaryRowFormulas_(r, r === first, categories.length));
  }
  sh.getRange(first, 1, SUMMARY_MONTHS, 1).setNumberFormat('@').setValues(months);
  sh.getRange(first, 2, SUMMARY_MONTHS, headers.length - 1).setFormulas(formulas);
}

// 1行分の数式（B 列〜）。月の範囲は「その月の1日以上、翌月1日未満」で数える。
function summaryRowFormulas_(r, isFirst, categoryCount) {
  const from = 'DATEVALUE($A' + r + '&"-01")';
  const range = 'expenses!$B:$B,">="&' + from + ',expenses!$B:$B,"<"&EDATE(' + from + ',1)';
  const row = [
    // SUMIF だと「2026-11」が日付として解釈されうるので、文字列どうしの一致で数える
    '=SUMPRODUCT((incomes!$A$2:$A=$A' + r + ')*incomes!$C$2:$C)',
    '=SUMIFS(expenses!$C:$C,' + range + ')',
    '=SUMIFS(expenses!$C:$C,' + range + ',expenses!$D:$D,"' + FIXED_CATEGORY + '")',
    '=C' + r + '-D' + r,
    isFirst ? '=$B$1' : '=G' + (r - 1),
    '=F' + r + '+B' + r + '-C' + r,
  ];
  for (let k = 0; k < categoryCount; k++) {
    const c = columnLetter_(8 + k);
    row.push('=SUMIFS(expenses!$C:$C,' + range + ',expenses!$D:$D,' + c + '$' + SUMMARY_HEADER_ROW + ')');
  }
  return row;
}

function setupFixedCostTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'addFixedCosts')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('addFixedCosts').timeBased().onMonthDay(1).atHour(0).create();
}

// ---------- 小物 ----------

function nowMonth_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
}

function addMonths_(month, n) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12 + 1;
  return yy + '-' + (mm < 10 ? '0' : '') + mm;
}

// 「2026-11」の文字列でも、日付に変換されてしまったセルでも、yyyy-MM にそろえる。
function monthText_(v) {
  if (isDate_(v)) return Utilities.formatDate(v, TZ, 'yyyy-MM');
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[-/](\d{1,2})/);
  return m ? m[1] + '-' + (m[2].length === 1 ? '0' : '') + m[2] : '';
}

function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}

function findRow_(values, idCol, id) {
  for (let i = 1; i < values.length; i++) if (String(values[i][idCol]) === id) return i;
  return -1;
}

function columnLetter_(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('missing_sheet:' + name);
  return sh;
}

// 列は位置ではなく見出し名で探す。列を足しても壊れない。
function columns_(header, names) {
  const col = {};
  names.forEach((n) => {
    const i = header.indexOf(n);
    if (i === -1) throw new Error('missing_column:' + n);
    col[n] = i;
  });
  return col;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
