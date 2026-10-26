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

const batch = (entries, over = {}) => JSON.stringify({ action: 'addBatch', token: 'dev-token', data: { entries }, ...over });
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

test('addBatch はまとめて足し、1件ずつ結果を返す', () => {
  const gas = loadGas();
  const res = gas.post(batch([
    entry({ id: 'b1', date: daysAgo(0), amount: 1200 }),
    entry({ id: 'b2', date: daysAgo(0), amount: 330, category: '本' }),
  ]));
  assert.equal(res.ok, true);
  assert.deepEqual(res.data.results, [
    { id: 'b1', ok: true, updated: false },
    { id: 'b2', ok: true, updated: false },
  ]);
  assert.deepEqual(gas.sheets.expenses.slice(1).map((r) => [r[0], r[2], r[3]]), [['b1', 1200, '食費'], ['b2', 330, '本']]);
  assert.equal(res.data.state.spent, 1530);
});

test('addBatch は不正な1件があっても残りを書き込む', () => {
  const gas = loadGas();
  const res = gas.post(batch([
    entry({ id: 'c1' }),
    entry({ id: 'c2', category: '交際' }),
    entry({ id: 'c3', amount: -5 }),
  ]));
  assert.deepEqual(res.data.results.map((r) => [r.id, r.ok, r.error]), [
    ['c1', true, undefined], ['c2', false, 'unknown_category'], ['c3', false, 'invalid_amount'],
  ]);
  assert.equal(gas.sheets.expenses.length, 2);
});

test('addBatch の送り直しは二重にならず、同じ束の中の重複も1行になる', () => {
  const gas = loadGas();
  const entries = [entry({ id: 'd1' }), entry({ id: 'd2' })];
  gas.post(batch(entries));
  const again = gas.post(batch([...entries, entry({ id: 'd3' }), entry({ id: 'd3', amount: 999 })]));
  assert.deepEqual(again.data.results.map((r) => r.updated), [true, true, false, true]);
  const ids = gas.sheets.expenses.slice(1).map((r) => r[0]);
  assert.deepEqual(ids, ['d1', 'd2', 'd3']);
  assert.equal(gas.sheets.expenses[3][2], 999);
});

test('上書きのとき、見出しにない列の値は残す', () => {
  const gas = loadGas();
  gas.sheets.expenses[0].push('memo');
  gas.post(batch([entry({ id: 'm1' })]));
  gas.sheets.expenses[1][4] = 'ランチ';
  gas.post(batch([entry({ id: 'm1', amount: 800 })]));
  assert.equal(gas.sheets.expenses[1][2], 800);
  assert.equal(gas.sheets.expenses[1][4], 'ランチ');
});

test('addBatch は空や多すぎる束を断る', () => {
  const gas = loadGas();
  assert.equal(gas.post(batch([])).error, 'invalid_entries');
  assert.equal(gas.post(batch(Array.from({ length: 101 }, (_, i) => entry({ id: `x${i}` })))).error, 'invalid_entries');
  assert.equal(gas.post(JSON.stringify({ action: 'addBatch', token: 'dev-token', data: {} })).error, 'invalid_entries');
});

test('state は使えるカテゴリを並び順で返し、今月分だけ合計する', () => {
  const gas = loadGas();
  gas.sheets.categories[1][1] = 9;
  gas.sheets.categories[5][2] = false;
  gas.post(batch([
    entry({ id: 's1', date: daysAgo(0), amount: 1000 }),
    entry({ id: 's2', date: daysAgo(40), amount: 500 }),
  ]));
  const res = gas.post(JSON.stringify({ action: 'state', token: 'dev-token' }));
  assert.deepEqual(res.data.categories, ['日用品', 'ゲーム', '本', '現金引き落とし', 'その他', '食費']);
  assert.equal(res.data.spent, 1000);
  assert.match(res.data.month, /^\d{4}-\d{2}$/);
});

test('doGet はデータを返さない', () => {
  assert.deepEqual(loadGas().get(), { ok: true, app: 'kozeni' });
});
