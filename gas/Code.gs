// KOZENI の読み書き窓口。スプシ「KOZENI__DB用」に紐づけて、ウェブアプリとして公開する。
// リクエストは text/plain の POST で {action, token, data} の JSON を受け取る。

const TZ = 'Asia/Tokyo';
const MAX_BATCH = 100;

const ACTIONS = {
  add: add_,
  addBatch: addBatch_,
  state: state_,
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

// 合言葉を作ってスクリプトプロパティに保存し、ログに出す。エディタから1回だけ実行する。
// もう一度実行すると合言葉が変わり、端末側の設定も入れ直しになる。
function setupToken() {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('TOKEN', token);
  Logger.log(token);
}

function add_(d) {
  const r = saveEntries_([d])[0];
  if (!r.ok) throw new Error(r.error);
  return { id: r.id, updated: r.updated };
}

// 端末の未送信キューをまとめて受け取る。1件ずつ結果を返し、不正な1件で残りを止めない。
function addBatch_(d) {
  if (!Array.isArray(d.entries) || d.entries.length === 0 || d.entries.length > MAX_BATCH) {
    throw new Error('invalid_entries');
  }
  return { results: saveEntries_(d.entries), state: state_() };
}

// 入力画面に要るものだけ返す：使えるカテゴリと、今月（東京時間）の支出合計。
function state_() {
  const month = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
  const values = sheet_('expenses').getDataRange().getValues();
  const col = columns_(values[0], ['date', 'amount']);
  let spent = 0;
  for (let i = 1; i < values.length; i++) {
    const date = values[i][col.date];
    if (date instanceof Date && Utilities.formatDate(date, TZ, 'yyyy-MM') === month) {
      spent += Number(values[i][col.amount]) || 0;
    }
  }
  return { categories: activeCategories_(), month: month, spent: spent };
}

// 同じ id がすでにあれば上書きする。送り直しても行が増えない。
// 見出しにない列（あとで足したメモ列など）は、上書きのときも元の値を残す。
function saveEntries_(entries) {
  const categories = activeCategories_();
  const sh = sheet_('expenses');
  const values = sh.getDataRange().getValues();
  const width = values[0].length;
  const col = columns_(values[0], ['id', 'date', 'amount', 'category']);

  const existing = {};
  for (let i = 1; i < values.length; i++) existing[String(values[i][col.id])] = i;
  const appended = [];
  const pending = {};

  const results = entries.map((d) => {
    const error = validate_(d, categories);
    if (error) return { id: d && d.id, ok: false, error: error };

    const base = existing[d.id] !== undefined ? values[existing[d.id]].slice() : new Array(width).fill('');
    base[col.id] = d.id;
    base[col.date] = new Date(d.date);
    base[col.amount] = d.amount;
    base[col.category] = d.category;

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

function validate_(d, categories) {
  if (!d || typeof d.id !== 'string' || d.id === '') return 'invalid_id';
  if (!Number.isInteger(d.amount) || d.amount <= 0 || d.amount >= 10000000) return 'invalid_amount';
  if (isNaN(new Date(d.date).getTime())) return 'invalid_date';
  if (categories.indexOf(d.category) === -1) return 'unknown_category';
  return null;
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
