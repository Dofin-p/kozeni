// gas/Code.gs を Node で動かすための模擬環境。スプシはメモリ上の2次元配列で持つ。
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

  const makeSheet = (name) => ({
    getDataRange: () => ({ getValues: () => sheets[name].map((r) => [...r]) }),
    appendRow: (row) => { sheets[name].push([...row]); },
    getRange: (row, col, numRows, numCols) => ({
      setValues: (vals) => {
        for (let i = 0; i < numRows; i++) {
          sheets[name][row - 1 + i] ??= [];
          for (let j = 0; j < numCols; j++) sheets[name][row - 1 + i][col - 1 + j] = vals[i][j];
        }
      },
    }),
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
    Utilities: { getUuid: () => randomUUID(), formatDate },
    Logger: { log: () => {} },
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('gas/Code.gs', root), 'utf8'), ctx, { filename: 'Code.gs' });

  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: body } }).getContent());
  const get = () => JSON.parse(ctx.doGet({}).getContent());
  return { ctx, sheets, props, post, get };
}
