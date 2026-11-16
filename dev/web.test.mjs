// node --test dev/web.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as calc from '../web/calc.js';
import { createStore, HOLD_MS, monthOf } from '../web/store.js';

const keys = (...ks) => ks.reduce((s, k) => calc.press(s, k), calc.empty());

test('数字・00・+ で合計が出る', () => {
  const s = keys('1', '2', '00', '+', '3', '3', '0');
  assert.equal(calc.total(s), 1530);
  assert.equal(calc.expression(s), '1,200 + 330');
});

test('先頭の0は無視し、7桁を超えて打てない', () => {
  assert.deepEqual(keys('0', '00', '5').terms, ['5']);
  assert.equal(calc.total(keys('1', '2', '3', '4', '5', '6', '7', '8')), 1234567);
});

test('空の項では + が増えず、⌫ で + を消せる', () => {
  assert.deepEqual(keys('+').terms, ['']);
  assert.deepEqual(keys('5', '+', '+').terms, ['5', '']);
  assert.equal(calc.expression(keys('5', '+')), '5 +');
  assert.deepEqual(keys('5', '+', 'back').terms, ['5']);
  assert.deepEqual(keys('5', '+', '3', 'back', 'back', 'back').terms, ['']);
  assert.deepEqual(keys('5', '+', '3', 'clear').terms, ['']);
});

test('1項だけなら式は出さない', () => {
  assert.equal(calc.expression(keys('1', '2')), '');
  assert.equal(calc.yen(1234567), '¥1,234,567');
});

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
}

function setup(start = Date.parse('2026-11-10T03:00:00Z')) {
  let t = start;
  let n = 0;
  const storage = memoryStorage();
  const make = () => createStore({ storage, now: () => t, uuid: () => `id${++n}` });
  return { store: make(), reopen: make, tick: (ms) => { t += ms; } };
}

test('記録は取り消し期間中は送らず、過ぎたら送れる', () => {
  const { store, tick } = setup();
  const e = store.enqueue(1200, '食費');
  assert.equal(store.sendable().length, 0);
  assert.equal(store.nextReleaseIn(), HOLD_MS);
  tick(HOLD_MS);
  assert.deepEqual(store.sendable().map((x) => x.id), [e.id]);
  assert.equal(store.nextReleaseIn(), null);
});

test('取り消しは期間中だけ効く', () => {
  const { store, tick } = setup();
  const a = store.enqueue(100, '本');
  const b = store.enqueue(200, '本');
  assert.equal(store.undo(a.id), true);
  tick(HOLD_MS);
  assert.equal(store.undo(b.id), false);
  assert.deepEqual(store.queue().map((x) => x.id), [b.id]);
});

test('キューは保存され、開き直しても残る', () => {
  const { store, reopen } = setup();
  store.enqueue(500, 'ゲーム');
  store.setConfig({ url: 'u', token: 't' });
  const again = reopen();
  assert.equal(again.queue().length, 1);
  assert.deepEqual(again.config(), { url: 'u', token: 't' });
});

test('今月の支出は前回の合計に未送信分を足す。月が変わったら前回の合計は使わない', () => {
  const { store, tick } = setup();
  store.setCached({ categories: [], month: '2026-11', spent: 10000 });
  store.enqueue(1200, '食費');
  assert.equal(store.spentThisMonth(), 11200);
  store.remove(store.queue().map((e) => e.id));
  assert.equal(store.spentThisMonth(), 10000);
  tick(30 * 86400000);
  assert.equal(monthOf(Date.parse('2026-12-10T03:00:00Z')), '2026-12');
  assert.equal(store.spentThisMonth(), 0);
});

test('localStorage が使えなくてもメモリで動く', () => {
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  const store = createStore({ storage: broken, uuid: () => 'x' });
  store.enqueue(1, 'その他');
  store.setConfig({ url: 'u' });
  assert.equal(store.queue().length, 1);
  assert.deepEqual(store.config(), { url: 'u' });
});

// ---------- 収入の入力 ----------
import { parseAmount, incomeFields } from '../web/income.js';

test('収入の金額は「45,000」「４５０００円」も読む', () => {
  assert.equal(parseAmount('45000'), 45000);
  assert.equal(parseAmount('45,000'), 45000);
  assert.equal(parseAmount('４５０００円'), 45000);
  assert.ok(Number.isNaN(parseAmount('4.5万')));
  assert.ok(Number.isNaN(parseAmount('')));
});

test('収入の入力は名前と金額を確かめる', () => {
  assert.deepEqual(incomeFields(' バイト ', '53,131'), { name: 'バイト', amount: 53131 });
  assert.match(incomeFields('', '1000').error, /名前/);
  assert.match(incomeFields('あ'.repeat(21), '1000').error, /20文字/);
  assert.match(incomeFields('バイト', '0').error, /金額/);
  assert.match(incomeFields('バイト', '10000000').error, /金額/);
});

test('同じ月に同じ名前の収入があれば知らせる（自分自身は数えない）', async () => {
  const { sameNameIn } = await import('../web/income.js');
  const existing = [{ id: 'a', name: '仕送り', amount: 45000 }, { id: 'b', name: 'バイト', amount: 53131 }];
  assert.equal(sameNameIn(existing, ' 仕送り ', null).id, 'a');
  assert.equal(sameNameIn(existing, '仕送り', 'a'), null);
  assert.equal(sameNameIn(existing, '臨時', null), null);
  assert.equal(sameNameIn(undefined, '仕送り', null), null);
});
