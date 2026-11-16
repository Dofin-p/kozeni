// node --test dev/month.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../web/month.js';

const base = () => ({
  month: '2026-11',
  spent: 25225,
  fixed: 15225,
  variable: 10000,
  balance: 50000,
  byCategory: [{ name: '食費', amount: 6000, count: 3 }, { name: 'その他', amount: 4000, count: 1 }],
  trend: [
    { month: '2026-10', byCategory: { 食費: 8000 } },
    { month: '2026-11', byCategory: { 食費: 6000, その他: 4000 } },
  ],
  entries: [
    { id: 'a', date: '2026-11-05T03:00:00.000Z', amount: 4000, category: 'その他', memo: '' },
    { id: 'fx', date: '2026-10-31T15:00:00.000Z', amount: 15225, category: '固定費', memo: 'サブスク' },
  ],
});

test('未送信の記録を足して見せる（合計・カテゴリ・推移・明細・残り）', () => {
  const queue = [
    { id: 'q1', date: '2026-11-06T03:00:00.000Z', amount: 500, category: '本' },
    { id: 'q2', date: '2026-11-06T04:00:00.000Z', amount: 1000, category: '食費' },
    { id: 'q3', date: '2026-12-01T03:00:00.000Z', amount: 9, category: '本' },
  ];
  const d = M.withPending(base(), queue);
  assert.equal(d.spent, 26725);
  assert.equal(d.variable, 11500);
  assert.equal(d.balance, 48500);
  assert.deepEqual(d.byCategory.map((c) => [c.name, c.amount, c.count]), [['食費', 7000, 4], ['その他', 4000, 1], ['本', 500, 1]]);
  assert.deepEqual(d.trend[1].byCategory, { 食費: 7000, その他: 4000, 本: 500 });
  assert.deepEqual(d.entries.map((e) => [e.id, !!e.pending]), [['q2', true], ['q1', true], ['a', false], ['fx', false]]);
  assert.equal(base().byCategory[0].amount, 6000, '元のデータは書き換えない');
});

test('サーバにもう届いている記録は二重に足さない', () => {
  const d = M.withPending(base(), [{ id: 'a', date: '2026-11-05T03:00:00.000Z', amount: 4000, category: 'その他' }]);
  assert.equal(d.spent, 25225);
});

test('開始月より前（残りなし）の月でも足せる', () => {
  const d = M.withPending({ ...base(), balance: null }, [{ id: 'q', date: '2026-11-06T03:00:00.000Z', amount: 1, category: '本' }]);
  assert.equal(d.balance, null);
});

test('割合は多い順で「その他」は最後、固定費は入らない', () => {
  const data = { ...base(), byCategory: [{ name: 'その他', amount: 9000, count: 1 }, { name: '本', amount: 1000, count: 1 }, { name: '食費', amount: 0, count: 0 }] };
  const s = M.shares(data);
  assert.deepEqual(s.map((x) => x.name), ['本', 'その他']);
  assert.equal(M.percent(s[1].share), '90.0%');
});

test('前の月の使った額', () => {
  assert.equal(M.previousVariable(base()), 8000);
  assert.equal(M.previousVariable({ trend: [{ month: '2026-11', byCategory: {} }] }), null);
});

test('色は並び順で決まり、その他・固定費・知らないカテゴリは灰色', () => {
  const cats = ['食費', '日用品', 'その他'];
  assert.equal(M.colorOf('日用品', cats), M.COLORS[1]);
  assert.equal(M.colorOf('その他', cats), M.GRAY);
  assert.equal(M.colorOf('固定費', cats), M.GRAY);
  assert.equal(M.colorOf('交際', cats), M.GRAY);
});

test('月の足し引きと表示', () => {
  assert.equal(M.addMonths('2026-11', 2), '2027-01');
  assert.equal(M.addMonths('2026-01', -1), '2025-12');
  assert.equal(M.monthLabel('2026-03'), '2026年3月');
});

test('日ごとにまとめ、日の合計を出す', () => {
  const days = M.groupByDay([
    { date: new Date(2026, 10, 6, 21).toISOString(), amount: 300 },
    { date: new Date(2026, 10, 6, 8).toISOString(), amount: 200 },
    { date: new Date(2026, 10, 5, 12).toISOString(), amount: 100 },
  ]);
  assert.deepEqual(days.map((d) => [d.label, d.total, d.items.length]), [['11/6（金）', 500, 2], ['11/5（木）', 100, 1]]);
});

test('datetime-local との行き来', () => {
  const iso = new Date(2026, 10, 6, 9, 5).toISOString();
  assert.equal(M.toLocalInput(iso), '2026-11-06T09:05');
  assert.equal(M.fromLocalInput('2026-11-06T09:05'), iso);
  assert.equal(M.fromLocalInput(''), null);
});

// ---------- 記録が止まっていないかの注意 ----------

const NOW = Date.parse('2026-11-16T12:00:00+09:00');
const H = 3600000;
const health = (o = {}) => ({ month: '2026-11', fixedMissing: [], lastRecordedAt: new Date(NOW - 2 * H).toISOString(), ...o });
const queued = (hoursAgo) => ({ id: `q${hoursAgo}`, date: new Date(NOW - hoursAgo * H).toISOString(), amount: 100, category: '食費' });

test('notices は何もなければ空', () => {
  assert.deepEqual(M.notices(health(), [], NOW), []);
  assert.deepEqual(M.notices(null, [], NOW), [], '一度もつながっていなければ何も言わない');
  assert.deepEqual(M.notices(health(), [queued(23)], NOW), [], '1日未満の未送信は知らせない');
});

test('notices は固定費の抜けを最初に、強い色で出す', () => {
  const list = M.notices(health({ fixedMissing: ['GPT', 'Gemini'] }), [], NOW);
  assert.equal(list.length, 1);
  assert.equal(list[0].tone, 'ng');
  assert.match(list[0].text, /GPT・Gemini/);
  assert.deepEqual(M.notices(health({ month: '2026-10', fixedMissing: ['GPT'] }), [], NOW), [], '前の月の手がかりは使わない');
});

test('notices は1日以上送れていない記録を知らせる', () => {
  const list = M.notices(health(), [queued(50), queued(1)], NOW);
  assert.equal(list.length, 1);
  assert.equal(list[0].tone, 'warn');
  assert.match(list[0].text, /2日前の記録を含む 2件/);
});

test('notices は最後の記録から3日たったら知らせる。未送信の記録も「記録」に数える', () => {
  const old = health({ lastRecordedAt: new Date(NOW - 80 * H).toISOString() });
  assert.match(M.notices(old, [], NOW)[0].text, /最後の記録から 3日/);
  assert.deepEqual(M.notices(old, [queued(1)], NOW), [], '端末に新しい記録があれば止まっていない');
  assert.deepEqual(M.notices(health({ lastRecordedAt: new Date(NOW - 71 * H).toISOString() }), [], NOW), []);
  assert.deepEqual(M.notices(health({ lastRecordedAt: null }), [], NOW), [], '記録が1件も無いうちは言わない');
});
