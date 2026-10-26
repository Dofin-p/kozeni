// KOZENI の読み書き窓口。スプシ「KOZENI__DB用」に紐づけて、ウェブアプリとして公開する。
// リクエストは text/plain の POST で {action, token, data} の JSON を受け取る。

const ACTIONS = {
  add: add_,
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

// 同じ id がすでにあれば上書きする。送り直しても行が増えない。
function add_(d) {
  if (typeof d.id !== 'string' || d.id === '') throw new Error('invalid_id');
  if (!Number.isInteger(d.amount) || d.amount <= 0 || d.amount >= 10000000) throw new Error('invalid_amount');
  const date = new Date(d.date);
  if (isNaN(date.getTime())) throw new Error('invalid_date');
  if (activeCategories_().indexOf(d.category) === -1) throw new Error('unknown_category');

  const sh = sheet_('expenses');
  const values = sh.getDataRange().getValues();
  const col = columns_(values[0], ['id', 'date', 'amount', 'category']);

  const row = new Array(values[0].length).fill('');
  row[col.id] = d.id;
  row[col.date] = date;
  row[col.amount] = d.amount;
  row[col.category] = d.category;

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][col.id]) === d.id) {
      sh.getRange(i + 1, 1, 1, row.length).setValues([row]);
      return { id: d.id, updated: true };
    }
  }
  sh.appendRow(row);
  return { id: d.id, updated: false };
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
