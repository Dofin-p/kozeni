// node --test dev/test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from './gas-mock.mjs';

const entry = (over = {}) => ({
  id: 'a1', date: '2026-11-01T03:00:00.000Z', amount: 1200, category: '食費', ...over,
});
const req = (data, over = {}) => JSON.stringify({ action: 'add', token: 'dev-token', data, ...over });

test('add は expenses に1行足す', () => {
  const gas = loadGas();
  const res = gas.post(req(entry()));
  assert.deepEqual(res, { ok: true, data: { id: 'a1', updated: false } });
  const rows = gas.sheets.expenses;
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], 'a1');
  assert.equal(Object.prototype.toString.call(rows[1][1]), '[object Date]');
  assert.equal(rows[1][1].toISOString(), '2026-11-01T03:00:00.000Z');
  assert.equal(rows[1][2], 1200);
  assert.equal(rows[1][3], '食費');
});

test('同じ id を送り直しても行は増えず上書きされる', () => {
  const gas = loadGas();
  gas.post(req(entry()));
  const res = gas.post(req(entry({ amount: 1500 })));
  assert.deepEqual(res.data, { id: 'a1', updated: true });
  assert.equal(gas.sheets.expenses.length, 2);
  assert.equal(gas.sheets.expenses[1][2], 1500);
});

test('列の並びが変わっても見出し名で書き込む', () => {
  const gas = loadGas();
  gas.sheets.expenses[0] = ['category', 'amount', 'memo', 'date', 'id'];
  gas.post(req(entry()));
  const row = gas.sheets.expenses[1];
  assert.equal(row[0], '食費');
  assert.equal(row[1], 1200);
  assert.equal(row[2], '');
  assert.equal(row[4], 'a1');
});

test('合言葉が違えば書き込まない', () => {
  const gas = loadGas();
  assert.deepEqual(gas.post(req(entry(), { token: 'wrong' })), { ok: false, error: 'unauthorized' });
  assert.deepEqual(gas.post(JSON.stringify({ action: 'add', data: entry() })), { ok: false, error: 'unauthorized' });
  assert.equal(gas.sheets.expenses.length, 1);
});

test('TOKEN が未設定なら誰も書き込めない', () => {
  const gas = loadGas();
  delete gas.props.TOKEN;
  assert.equal(gas.post(req(entry(), { token: undefined })).error, 'unauthorized');
});

test('不正な入力は理由つきで断る', () => {
  const gas = loadGas();
  const cases = [
    [entry({ amount: 0 }), 'invalid_amount'],
    [entry({ amount: 12.5 }), 'invalid_amount'],
    [entry({ amount: '1200' }), 'invalid_amount'],
    [entry({ id: '' }), 'invalid_id'],
    [entry({ date: 'yesterday' }), 'invalid_date'],
    [entry({ category: '交際' }), 'unknown_category'],
  ];
  for (const [data, error] of cases) assert.deepEqual(gas.post(req(data)), { ok: false, error }, error);
  assert.deepEqual(gas.post('not json'), { ok: false, error: 'bad_json' });
  assert.deepEqual(gas.post(req(entry(), { action: 'drop' })), { ok: false, error: 'unknown_action' });
  assert.equal(gas.sheets.expenses.length, 1);
});

test('active が外れたカテゴリには書き込めない', () => {
  const gas = loadGas();
  gas.sheets.categories[2][2] = false;
  assert.equal(gas.post(req(entry({ category: '日用品' }))).error, 'unknown_category');
});

test('setupToken は合言葉を作り直す', () => {
  const gas = loadGas();
  gas.ctx.setupToken();
  assert.match(gas.props.TOKEN, /^[0-9a-f]{64}$/);
  assert.notEqual(gas.props.TOKEN, 'dev-token');
});

test('doGet はデータを返さない', () => {
  assert.deepEqual(loadGas().get(), { ok: true, app: 'kozeni' });
});
