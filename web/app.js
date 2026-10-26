import * as calc from './calc.js';
import { createStore, HOLD_MS, monthOf } from './store.js';
import { call, isRetryable } from './api.js';

// 色はカテゴリの並び順で固定する（まとめ画面の円グラフと同じ割り当て）。「その他」だけ灰色。
const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'];
const OTHER_COLOR = '#888780';
const RETRY_MAX_MS = 60000;

const $ = (id) => document.getElementById(id);
let storage = null;
try { storage = window.localStorage; } catch {}
const store = createStore({ storage });

let input = calc.empty();
let syncing = false;
let error = null;
let retryDelay = 0;
let flushTimer = null;
let toastTimer = null;
let stateSeq = 0;

// ---------- 表示 ----------

function render() {
  const month = monthOf(Date.now());
  $('monthLabel').textContent = `${Number(month.slice(5))}月の支出`;
  $('spent').textContent = calc.yen(store.spentThisMonth());
  renderDisplay();
  renderSync();
  renderCategories();
  renderQueue();
}

function renderDisplay() {
  const total = calc.total(input);
  $('amount').textContent = calc.yen(total);
  $('amount').classList.toggle('zero', total === 0);
  const expr = $('expr');
  if (!expr.classList.contains('ng')) expr.textContent = calc.expression(input);
}

function renderSync() {
  const pending = store.queue().length;
  const el = $('sync');
  let text = '同期済み';
  let tone = '';
  if (error === 'unauthorized') { text = '合言葉が違います'; tone = 'ng'; }
  else if (error === 'not_configured') { text = '未設定'; tone = 'ng'; }
  else if (error && error !== 'network' && error !== 'busy') { text = `送信できません（${error}）`; tone = 'ng'; }
  else if (syncing) { text = '送信中…'; tone = 'warn'; }
  else if (pending > 0 && error) { text = `未送信 ${pending}件・再送待ち`; tone = 'warn'; }
  else if (pending > 0) { text = `未送信 ${pending}件`; tone = 'warn'; }
  el.textContent = text;
  el.className = `sync ${tone}`;
}

let renderedCats = '';
function renderCategories() {
  const cached = store.cached();
  const names = cached && cached.categories ? cached.categories : [];
  const key = names.join('\n');
  if (key === renderedCats && $('cats').childElementCount) return;
  renderedCats = key;
  const box = $('cats');
  box.textContent = '';
  if (names.length === 0) {
    const b = document.createElement('button');
    b.className = 'cats-empty';
    b.textContent = '設定で GAS とつなぐとカテゴリが出ます';
    b.addEventListener('click', openSettings);
    box.append(b);
    return;
  }
  names.forEach((name, i) => {
    const b = document.createElement('button');
    b.className = 'cat';
    b.setAttribute('aria-label', `${name}で記録`);
    // 長い名前は途中で折り返すと読みにくいので2マス使う
    if ([...name].length >= 6) b.style.gridColumn = 'span 2';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = name === 'その他' ? OTHER_COLOR : COLORS[i % COLORS.length];
    const label = document.createElement('span');
    label.textContent = name;
    b.append(dot, label);
    b.addEventListener('click', () => commit(name));
    box.append(b);
  });
}

function renderQueue() {
  const q = store.queue();
  $('queueBox').hidden = q.length === 0;
  $('queueList').textContent = '';
  q.forEach((e) => {
    const row = document.createElement('div');
    const d = new Date(e.date);
    const left = document.createElement('span');
    left.textContent = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}　${e.category}`;
    const right = document.createElement('span');
    right.textContent = calc.yen(e.amount);
    row.append(left, right);
    $('queueList').append(row);
  });
}

function complain(message) {
  const expr = $('expr');
  expr.textContent = message;
  expr.classList.add('ng');
  const amount = $('amount');
  amount.classList.remove('shake');
  void amount.offsetWidth;
  amount.classList.add('shake');
  setTimeout(() => { expr.classList.remove('ng'); renderDisplay(); }, 1500);
}

// ---------- 入力 ----------

function press(key) {
  $('expr').classList.remove('ng');
  input = calc.press(input, key);
  renderDisplay();
}

function commit(category) {
  const amount = calc.total(input);
  if (amount <= 0) return complain('金額を入れてください');
  if (amount >= calc.LIMIT) return complain('1,000万円未満にしてください');
  const entry = store.enqueue(amount, category);
  input = calc.empty();
  showToast(`${calc.yen(amount)}　${category}`, entry.id);
  render();
  scheduleFlush(HOLD_MS + 50);
}

function showToast(message, undoId) {
  clearTimeout(toastTimer);
  $('toastMsg').textContent = message;
  const undo = $('undo');
  undo.hidden = !undoId;
  undo.onclick = () => {
    if (store.undo(undoId)) showToast('取り消しました');
    else showToast('送信が始まったので取り消せませんでした');
    render();
  };
  const bar = $('toastBar');
  bar.classList.remove('run');
  bar.hidden = !undoId;
  if (undoId) {
    void bar.offsetWidth;
    bar.style.animationDuration = `${HOLD_MS}ms`;
    bar.classList.add('run');
  }
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, undoId ? HOLD_MS : 1800);
}

// ---------- 送信 ----------

function scheduleFlush(ms) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, Math.max(0, ms));
}

async function flush() {
  const cfg = store.config();
  if (syncing) return;
  if (!cfg.url || !cfg.token) { if (store.queue().length) error = 'not_configured'; render(); return; }
  if (error && !isRetryableCode(error)) return;

  const batch = store.sendable().slice(0, 100);
  if (batch.length === 0) {
    const wait = store.nextReleaseIn();
    if (wait != null) scheduleFlush(wait + 50);
    return;
  }

  syncing = true;
  renderSync();
  try {
    const entries = batch.map(({ id, date, amount, category }) => ({ id, date, amount, category }));
    const res = await call(cfg, 'addBatch', { entries });
    stateSeq++;
    store.setCached(res.state);
    store.remove(res.results.map((r) => r.id));
    const rejected = res.results.filter((r) => !r.ok);
    if (rejected.length) {
      const first = batch.find((e) => e.id === rejected[0].id);
      showToast(`${rejected.length}件を記録できませんでした（${first ? `${calc.yen(first.amount)} ${first.category}` : ''}・${rejected[0].error}）`);
    }
    error = null;
    retryDelay = 0;
  } catch (err) {
    error = err && err.code ? err.code : 'network';
    if (isRetryable(err)) {
      retryDelay = Math.min(retryDelay ? retryDelay * 2 : 5000, RETRY_MAX_MS);
      scheduleFlush(retryDelay);
    }
  } finally {
    syncing = false;
    render();
  }

  if (!error && store.queue().length) {
    scheduleFlush(store.sendable().length ? 0 : (store.nextReleaseIn() ?? 0) + 50);
  }
}

const isRetryableCode = (code) => code === 'network' || code === 'busy';

async function refreshState() {
  const cfg = store.config();
  if (!cfg.url || !cfg.token) return null;
  const seq = ++stateSeq;
  try {
    const state = await call(cfg, 'state');
    // 待っている間に送信が終わっていたら、そちらの結果のほうが新しい
    if (seq === stateSeq) store.setCached(state);
    if (error === 'unauthorized' || error === 'not_configured') error = null;
    render();
    return state;
  } catch (err) {
    if (err && err.code) { error = err.code; render(); }
    throw err;
  }
}

// ---------- 設定 ----------

function openSettings() {
  const cfg = store.config();
  $('url').value = cfg.url || '';
  $('token').value = cfg.token || '';
  $('connNote').textContent = '';
  $('connNote').className = 'note';
  renderQueue();
  $('settings').hidden = false;
}

async function saveSettings() {
  const url = $('url').value.trim();
  const token = $('token').value.trim();
  store.setConfig({ url, token });
  error = null;
  retryDelay = 0;
  const note = $('connNote');
  note.className = 'note';
  note.textContent = '確かめています…';
  try {
    const state = await refreshState();
    if (!state) throw new Error('URL と合言葉を入れてください');
    note.className = 'note ok';
    note.textContent = `つながりました（カテゴリ ${state.categories.length} 件・今月 ${calc.yen(state.spent)}）`;
    flush();
  } catch (err) {
    note.className = 'note ng';
    note.textContent = describeError(err);
  }
  render();
}

function describeError(err) {
  const code = err && err.code;
  if (code === 'unauthorized') return '合言葉が違います。';
  if (code === 'unknown_action') return 'GAS が古いままです。Code.gs を貼り直して「新バージョン」でデプロイしてください。';
  if (code) return `GAS がエラーを返しました（${code}）。`;
  if (err && err.message && !(err instanceof TypeError) && err.name !== 'AbortError') return err.message;
  return 'つながりませんでした。URL が /exec で終わっているか、アクセスできるユーザーが「全員」かを確かめてください。';
}

// ---------- 起動 ----------

$('pad').addEventListener('click', (e) => {
  const key = e.target.closest('[data-key]');
  if (key) press(key.dataset.key);
});
$('openSettings').addEventListener('click', openSettings);
$('closeSettings').addEventListener('click', () => { $('settings').hidden = true; });
$('save').addEventListener('click', saveSettings);
$('retry').addEventListener('click', () => { error = null; retryDelay = 0; flush(); });

document.addEventListener('keydown', (e) => {
  if (!$('settings').hidden || e.metaKey || e.ctrlKey) return;
  if (/^\d$/.test(e.key) || e.key === '+') press(e.key);
  else if (e.key === 'Backspace') press('back');
  else if (e.key === 'Escape') press('clear');
});

// 開き直したとき・電波が戻ったときに、たまっている分を送る。GAS を直した後もここで1回試し直す。
const wake = () => {
  error = null;
  retryDelay = 0;
  flush();
  refreshState().catch(() => {});
};
window.addEventListener('online', wake);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

render();
if (!store.config().url) openSettings();
else wake();
