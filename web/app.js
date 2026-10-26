import * as calc from './calc.js';
import { createStore, HOLD_MS, monthOf } from './store.js';
import { call, isRetryable } from './api.js';
import { colorOf, withPending, addMonths, monthLabel } from './month.js';
import { renderHistory, openEditor } from './history.js';
import { renderSummary } from './summary.js';

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

// 履歴・まとめ画面の状態
let view = 'input';
let browseMonth = monthOf(Date.now());
let selectedCategory = null;
let loading = false;
let loadError = null;
const monthData = new Map();
// 送り終えたが、まだ月データを取り直していない記録。取り直すまで画面に足しておく。
const recentSent = new Map();
const cachedMonth = store.cachedMonth();
if (cachedMonth && cachedMonth.month) monthData.set(cachedMonth.month, cachedMonth);

// ---------- 表示 ----------

function render() {
  const month = monthOf(Date.now());
  $('monthLabel').textContent = `${Number(month.slice(5))}月の支出`;
  $('spent').textContent = calc.yen(store.spentThisMonth());
  renderDisplay();
  renderSync();
  renderCategories();
  renderQueue();
  if (view !== 'input') renderBrowse();
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
  names.forEach((name) => {
    const b = document.createElement('button');
    b.className = 'cat';
    b.setAttribute('aria-label', `${name}で記録`);
    // 長い名前は途中で折り返すと読みにくいので2マス使う
    if ([...name].length >= 6) b.style.gridColumn = 'span 2';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = colorOf(name, names);
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
    res.results.filter((r) => r.ok).forEach((r) => {
      const sent = batch.find((e) => e.id === r.id);
      if (sent) recentSent.set(sent.id, sent);
    });
    store.remove(res.results.map((r) => r.id));
    if (view !== 'input' && browseMonth === monthOf(Date.now())) loadMonth(browseMonth);
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

// ---------- 履歴・まとめ ----------

function showView(next) {
  view = next;
  document.querySelectorAll('.tab').forEach((t) => {
    if (t.dataset.view === next) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  $('view-input').hidden = next !== 'input';
  $('view-browse').hidden = next === 'input';
  selectedCategory = null;
  if (next === 'input') return render();
  renderBrowse();
  loadMonth(browseMonth);
}

// 手元にある月データに、未送信と送ったばかりの記録を足したもの。まだ一度も取れていなければ null。
function currentData() {
  const data = monthData.get(browseMonth);
  return data ? withPending(data, [...store.queue(), ...recentSent.values()]) : null;
}

function renderBrowse() {
  $('browseMonth').textContent = monthLabel(browseMonth);
  $('nextMonth').disabled = browseMonth >= monthOf(Date.now());

  const status = $('browseStatus');
  status.className = 'status';
  status.textContent = loading ? '読み込み中…' : '';
  if (!loading && loadError) {
    status.className = 'status ng';
    status.textContent = loadError === 'not_configured' ? '設定で GAS とつないでください' : `読み込めませんでした（${loadError}）`;
    const retry = document.createElement('button');
    retry.textContent = '再読み込み';
    retry.addEventListener('click', () => loadMonth(browseMonth));
    status.append(retry);
  }

  $('history').hidden = view !== 'history';
  $('summary').hidden = view !== 'summary';
  const target = view === 'history' ? $('history') : $('summary');
  const data = currentData();
  if (!data) { target.textContent = ''; return; }
  if (view === 'history') {
    renderHistory(target, data, { onEdit: edit });
  } else {
    renderSummary(target, data, {
      selected: selectedCategory,
      monthName: monthLabel(browseMonth),
      onSelect: (name) => { selectedCategory = name; renderBrowse(); target.scrollTop = 0; },
      onBack: () => { selectedCategory = null; renderBrowse(); },
      onEdit: edit,
    });
  }
}

let loadSeq = 0;
async function loadMonth(month) {
  const cfg = store.config();
  if (!cfg.url || !cfg.token) { loadError = 'not_configured'; renderBrowse(); return; }
  const seq = ++loadSeq;
  loading = true;
  loadError = null;
  if (view !== 'input') renderBrowse();
  try {
    const data = await call(cfg, 'month', { month });
    monthData.set(month, data);
    if (month === monthOf(Date.now())) store.setCachedMonth(data);
    data.entries.forEach((e) => recentSent.delete(e.id));
  } catch (err) {
    if (seq === loadSeq) loadError = err && err.code ? err.code : 'network';
  } finally {
    if (seq === loadSeq) loading = false;
    if (view !== 'input') renderBrowse();
  }
}

function moveMonth(n) {
  const next = addMonths(browseMonth, n);
  if (next > monthOf(Date.now())) return;
  browseMonth = next;
  selectedCategory = null;
  renderBrowse();
  loadMonth(browseMonth);
}

function edit(entry) {
  const data = currentData();
  openEditor(entry, data ? data.categories : [], {
    onSave: (e, patch) => mutate('update', { id: e.id, ...patch }, '保存しました'),
    onDelete: (e) => mutate('delete', { id: e.id }, '削除しました'),
  });
}

// 修正・削除はめったにしないので、端末に溜めずにその場で送る。失敗したら理由を返す。
async function mutate(action, data, done) {
  try {
    const res = await call(store.config(), action, data);
    stateSeq++;
    store.setCached(res.state);
    if (action === 'delete') recentSent.delete(data.id);
    await loadMonth(browseMonth);
    showToast(done);
    render();
    return null;
  } catch (err) {
    if (err && err.code) return describeError(err);
    return '通信できませんでした。電波のあるところでもう一度試してください。';
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

$('prevMonth').addEventListener('click', () => moveMonth(-1));
$('nextMonth').addEventListener('click', () => moveMonth(1));
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));

document.addEventListener('keydown', (e) => {
  if (view !== 'input' || !$('settings').hidden || !$('editSheet').hidden || e.metaKey || e.ctrlKey) return;
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
  if (view !== 'input') loadMonth(browseMonth);
};
window.addEventListener('online', wake);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

render();
if (!store.config().url) openSettings();
else wake();
