// node --test dev/phase3.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from './gas-mock.mjs';

const tokyoMonth = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).format(d).slice(0, 7);
const shift = (month, n) => {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const jst = (s) => new Date(`${s}+09:00`);

// 2026-01 開始、初期繰越 100,000 の家計を用意する
function household() {
  const gas = loadGas();
  gas.sheets.summary = [['初期繰越', 100000], ['開始月', '2026-01']];
  gas.sheets.expenses = [
    ['id', 'date', 'amount', 'category', 'memo'],
    ['old', jst('2025-12-20T12:00:00'), 9999, '食費', ''],
    ['j1', jst('2026-01-05T12:00:00'), 3000, '食費', ''],
    ['jf', jst('2026-01-01T00:00:00'), 15225, '固定費', 'サブスク'],
    ['f1', jst('2026-02-03T08:00:00'), 1200, '食費', ''],
    ['f2', jst('2026-02-10T21:00:00'), 7000, 'ゲーム', ''],
    ['f3', jst('2026-02-28T23:59:00'), 800, '食費', ''],
    ['ff', jst('2026-02-01T00:00:00'), 15225, '固定費', 'サブスク'],
    ['m1', jst('2026-03-01T00:30:00'), 500, '本', ''],
  ];
  gas.sheets.incomes = [
    ['month', 'name', 'amount'],
    ['2026-01', '仕送り', 45000],
    ['2026-02', '仕送り', 45000],
    [jst('2026-02-01T00:00:00'), 'バイト', 50000],
  ];
  return gas;
}

test('month は繰越と残高を開始月から積み上げる（summary の数式と同じ定義）', () => {
  const gas = household();
  const jan = gas.call('month', { month: '2026-01' }).data;
  assert.equal(jan.carryover, 100000);
  assert.equal(jan.income, 45000);
  assert.equal(jan.spent, 18225);
  assert.equal(jan.balance, 100000 + 45000 - 18225);

  const feb = gas.call('month', { month: '2026-02' }).data;
  assert.equal(feb.carryover, jan.balance);
  assert.equal(feb.income, 95000, '日付に変換されてしまった月のセルも数える');
  assert.deepEqual(feb.incomes.map((i) => i.name), ['仕送り', 'バイト']);
  assert.equal(feb.spent, 1200 + 7000 + 800 + 15225);
  assert.equal(feb.fixed, 15225);
  assert.equal(feb.variable, 9000);
  assert.equal(feb.balance, feb.carryover + 95000 - feb.spent);
});

test('month は開始月より前なら残高を出さない', () => {
  const dec = household().call('month', { month: '2025-12' }).data;
  assert.equal(dec.carryover, null);
  assert.equal(dec.balance, null);
  assert.equal(dec.spent, 9999);
});

test('month の明細は新しい順、カテゴリ別は固定費を除く、推移は6か月', () => {
  const feb = household().call('month', { month: '2026-02' }).data;
  assert.deepEqual(feb.entries.map((e) => e.id), ['f3', 'f2', 'f1', 'ff']);
  assert.equal(feb.entries.find((e) => e.id === 'ff').memo, 'サブスク');
  const by = Object.fromEntries(feb.byCategory.map((c) => [c.name, [c.amount, c.count]]));
  assert.deepEqual(by, { 食費: [2000, 2], ゲーム: [7000, 1] });
  assert.deepEqual(feb.trend.map((t) => t.month), ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepEqual(feb.trend[5].byCategory, { 食費: 2000, ゲーム: 7000 });
  assert.deepEqual(feb.trend[4].byCategory, { 食費: 3000 });
  assert.equal(feb.trend[3].byCategory['食費'], 9999);
});

test('月の境目は東京時間で分ける', () => {
  const gas = household();
  assert.equal(gas.call('month', { month: '2026-02' }).data.entries.some((e) => e.id === 'f3'), true);
  assert.equal(gas.call('month', { month: '2026-03' }).data.entries[0].id, 'm1');
});

test('month は形の違う月を断る', () => {
  assert.equal(household().call('month', { month: '2026/2' }).error, 'invalid_month');
});

test('update は送った項目だけ変える', () => {
  const gas = household();
  const res = gas.call('update', { id: 'f1', amount: 1500, category: '本' });
  assert.equal(res.ok, true);
  const row = gas.sheets.expenses.find((r) => r[0] === 'f1');
  assert.equal(row[2], 1500);
  assert.equal(row[3], '本');
  assert.equal(row[1].toISOString(), jst('2026-02-03T08:00:00').toISOString());
  assert.ok(res.data.state.categories.length > 0);

  gas.call('update', { id: 'f1', date: '2026-02-04T09:00:00+09:00' });
  assert.equal(gas.sheets.expenses.find((r) => r[0] === 'f1')[1].toISOString(), '2026-02-04T00:00:00.000Z');
});

test('update は固定費の金額を直せるが、知らないカテゴリや不正な値は断る', () => {
  const gas = household();
  assert.equal(gas.call('update', { id: 'ff', amount: 16000 }).ok, true);
  assert.equal(gas.sheets.expenses.find((r) => r[0] === 'ff')[2], 16000);
  assert.equal(gas.call('update', { id: 'f1', category: '交際' }).error, 'unknown_category');
  assert.equal(gas.call('update', { id: 'f1', amount: 0 }).error, 'invalid_amount');
  assert.equal(gas.call('update', { id: 'f1', date: '' }).error, 'invalid_date');
  assert.equal(gas.call('update', { id: 'nope', amount: 1 }).error, 'not_found');
});

test('使わなくしたカテゴリの記録も、カテゴリを変えなければ直せる', () => {
  const gas = household();
  gas.sheets.categories.find((r) => r[0] === 'ゲーム')[2] = false;
  assert.equal(gas.call('update', { id: 'f2', amount: 6500 }).ok, true);
  assert.equal(gas.call('update', { id: 'f1', category: 'ゲーム' }).error, 'unknown_category');
});

test('delete は行を消し、二度目はエラーにしない', () => {
  const gas = household();
  const before = gas.sheets.expenses.length;
  assert.equal(gas.call('delete', { id: 'f2' }).data.deleted, true);
  assert.equal(gas.sheets.expenses.length, before - 1);
  assert.equal(gas.sheets.expenses.some((r) => r[0] === 'f2'), false);
  const again = gas.call('delete', { id: 'f2' });
  assert.equal(again.ok, true);
  assert.equal(again.data.deleted, false);
});

test('addFixedCosts は開始月より前なら何もしない', () => {
  const gas = loadGas();
  gas.sheets.summary = [['初期繰越', 100000], ['開始月', shift(tokyoMonth(), 1)]];
  assert.equal(gas.ctx.addFixedCosts().length, 0);
  assert.equal(gas.sheets.expenses.length, 1);
});

test('addFixedCosts は今月分を1日0時で計上し、何度実行しても二重にならない', () => {
  const gas = loadGas();
  const month = tokyoMonth();
  gas.sheets.summary = [['初期繰越', 100000], ['開始月', month]];
  gas.sheets.expenses[0].push('memo');
  gas.sheets.fixed_costs.push(['やめたもの', 999, false]);
  gas.ctx.addFixedCosts();
  gas.ctx.addFixedCosts();
  const rows = gas.sheets.expenses.slice(1);
  assert.equal(rows.length, 7);
  assert.ok(rows.every((r) => r[3] === '固定費'));
  assert.equal(rows.reduce((s, r) => s + r[2], 0), 15225);
  assert.equal(rows[0][0], `fixed:${month}:クロード`);
  assert.equal(rows[0][4], 'クロード');
  assert.equal(rows[0][1].toISOString(), jst(`${month}-01T00:00:00`).toISOString());
  assert.equal(gas.call('state').data.spent, 15225);
});

test('setupPhase3 は memo 列・summary の表・月次トリガーを作る', () => {
  const gas = loadGas();
  gas.ctx.setupPhase3();
  gas.ctx.setupPhase3();

  assert.deepEqual(gas.sheets.expenses[0], ['id', 'date', 'amount', 'category', 'memo']);
  assert.equal(gas.triggers.length, 1, '2回実行してもトリガーは1つ');
  assert.deepEqual(gas.triggers[0], { fn: 'addFixedCosts', monthDay: 1, hour: 0 });

  const s = gas.sheets.summary;
  const start = shift(tokyoMonth(), 1);
  assert.deepEqual(s[1].slice(0, 2), ['開始月', start], '開始月が空なら来月を入れる');
  assert.equal(gas.formats['summary!2,2'], '@');
  assert.deepEqual(s[3].slice(0, 8), ['月', '収入', '支出', '固定費', '変動費', '繰越', '残高', '食費']);
  assert.equal(s[3].length, 7 + 7);
  assert.equal(s[4][0], start);
  assert.equal(s[5][0], shift(start, 1));
  assert.equal(s[4 + 23][0], shift(start, 23));
  assert.equal(gas.formats['summary!5,1'], '@');

  assert.equal(s[4][1], '=SUMPRODUCT((incomes!$A$2:$A=$A5)*incomes!$C$2:$C)');
  assert.equal(s[4][2], '=SUMIFS(expenses!$C:$C,expenses!$B:$B,">="&DATEVALUE($A5&"-01"),expenses!$B:$B,"<"&EDATE(DATEVALUE($A5&"-01"),1))');
  assert.match(s[4][3], /expenses!\$D:\$D,"固定費"\)$/);
  assert.equal(s[4][4], '=C5-D5');
  assert.equal(s[4][5], '=$B$1');
  assert.equal(s[5][5], '=G5');
  assert.equal(s[4][6], '=F5+B5-C5');
  assert.match(s[4][7], /expenses!\$D:\$D,H\$4\)$/);
  assert.match(s[4][13], /expenses!\$D:\$D,N\$4\)$/);
  assert.equal(gas.sheets.expenses.length, 1, '開始月より前なので固定費はまだ入らない');
});

test('setupPhase3 は既にある開始月を変えず、古い表の残りを消す', () => {
  const gas = loadGas();
  gas.sheets.summary = [['初期繰越', 50000], ['開始月', '2026-01'], [], ['古い'], ...Array.from({ length: 40 }, () => ['x', 'y'])];
  gas.ctx.setupPhase3();
  const s = gas.sheets.summary;
  assert.deepEqual(s[0].slice(0, 2), ['初期繰越', 50000]);
  assert.deepEqual(s[1].slice(0, 2), ['開始月', '2026-01']);
  assert.equal(s[3][0], '月');
  assert.equal(s[4][0], '2026-01');
  assert.equal(s[30]?.[0] ?? '', '', '24か月より下の古い行は空になる');
});
