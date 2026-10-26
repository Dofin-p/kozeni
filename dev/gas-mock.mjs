// gas/Code.gs を Node で動かすための模擬環境。スプシはメモリ上の2次元配列で持つ。
// 数式は計算せず、文字列のままセルに入れる（テストでは式の形だけ確かめる）。
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);

export function loadFixture() {
  return JSON.parse(readFileSync(new URL('dev/fixture.json', root), 'utf8'));
}

// Utilities.formatDate のうち、Code.gs が使う yyyy / MM / dd だけを真似る。
function formatDate(date, timeZone, pattern) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return pattern.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day);
}

export function loadGas(fixture = loadFixture()) {
  const sheets = structuredClone(fixture.sheets);
  const props = { TOKEN: fixture.token };
  const formats = {};
  const triggers = [];
  const logs = [];

  // 実物と同じく、データ範囲は末尾の空行を除いた長方形
  const dataRange = (name) => {
    const rows = sheets[name];
    let last = rows.length;
    while (last > 0 && rows[last - 1].every((v) => v === '' || v == null)) last--;
    const width = Math.max(1, ...rows.slice(0, last).map((r) => r.length));
    return rows.slice(0, last).map((r) => Array.from({ length: width }, (_, j) => (r[j] ?? '')));
  };

  const makeRange = (name, row, col, numRows, numCols) => {
    const range = {
      setValues(vals) {
        for (let i = 0; i < numRows; i++) {
          while (sheets[name].length < row + i) sheets[name].push([]);
          for (let j = 0; j < numCols; j++) sheets[name][row - 1 + i][col - 1 + j] = vals[i][j];
        }
        return range;
      },
      setFormulas(vals) { return range.setValues(vals); },
      setNumberFormat(fmt) {
        for (let i = 0; i < numRows; i++) for (let j = 0; j < numCols; j++) formats[`${name}!${row + i},${col + j}`] = fmt;
        return range;
      },
      clearContent() {
        for (let i = 0; i < numRows; i++) {
          const r = sheets[name][row - 1 + i];
          if (!r) continue;
          for (let j = 0; j < numCols; j++) if (col - 1 + j < r.length) r[col - 1 + j] = '';
        }
        return range;
      },
    };
    return range;
  };

  const makeSheet = (name) => ({
    getDataRange: () => ({ getValues: () => dataRange(name) }),
    getRange: (row, col, numRows = 1, numCols = 1) => makeRange(name, row, col, numRows, numCols),
    getMaxRows: () => Math.max(1000, sheets[name].length),
    getMaxColumns: () => Math.max(26, ...sheets[name].map((r) => r.length)),
    deleteRow: (row) => { sheets[name].splice(row - 1, 1); },
  });

  const ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: (n) => (sheets[n] ? makeSheet(n) : null) }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => props[k] ?? null,
        setProperty: (k, v) => { props[k] = v; },
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ setMimeType() { return this; }, getContent: () => s }),
    },
    ScriptApp: {
      getProjectTriggers: () => triggers.map((t) => ({ getHandlerFunction: () => t.fn, _t: t })),
      deleteTrigger: (t) => { triggers.splice(triggers.indexOf(t._t), 1); },
      newTrigger: (fn) => {
        const t = { fn };
        const chain = {
          timeBased: () => chain,
          onMonthDay: (d) => { t.monthDay = d; return chain; },
          atHour: (h) => { t.hour = h; return chain; },
          create: () => { triggers.push(t); return t; },
        };
        return chain;
      },
    },
    Utilities: { getUuid: () => randomUUID(), formatDate },
    Logger: { log: (m) => { logs.push(String(m)); } },
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('gas/Code.gs', root), 'utf8'), ctx, { filename: 'Code.gs' });

  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: body } }).getContent());
  const call = (action, data) => post(JSON.stringify({ action, token: props.TOKEN, data }));
  const get = () => JSON.parse(ctx.doGet({}).getContent());
  return { ctx, sheets, props, formats, triggers, logs, post, call, get };
}
