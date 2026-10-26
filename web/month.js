// 履歴とまとめ画面の計算。DOM には触らない。
import { monthOf } from './store.js';

export const FIXED_CATEGORY = '固定費';
export const OTHER = 'その他';
// 色はカテゴリの並び順で固定する。「その他」と固定費は灰色。
export const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'];
export const GRAY = '#888780';

export function colorOf(name, categories) {
  if (name === OTHER || name === FIXED_CATEGORY) return GRAY;
  const i = categories.indexOf(name);
  return i === -1 ? GRAY : COLORS[i % COLORS.length];
}

export function addMonths(month, n) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const d = new Date(y, m, 1);
  return monthOf(d);
}

export const monthLabel = (month) => `${month.slice(0, 4)}年${Number(month.slice(5))}月`;

// サーバの月データに、まだ届いていない記録（未送信キュー）を足して見せる。
// 送った直後で、サーバ側にもう同じ id があるものは足さない。
export function withPending(data, queue) {
  const known = new Set(data.entries.map((e) => e.id));
  const pending = queue.filter((e) => monthOf(e.date) === data.month && !known.has(e.id));
  if (pending.length === 0) return data;

  const sum = pending.reduce((s, e) => s + e.amount, 0);
  const byCategory = data.byCategory.map((c) => ({ ...c }));
  pending.forEach((e) => {
    let c = byCategory.find((x) => x.name === e.category);
    if (!c) byCategory.push((c = { name: e.category, amount: 0, count: 0 }));
    c.amount += e.amount;
    c.count += 1;
  });
  const trend = data.trend.map((t, i) => {
    if (i !== data.trend.length - 1) return t;
    const totals = { ...t.byCategory };
    pending.forEach((e) => { totals[e.category] = (totals[e.category] || 0) + e.amount; });
    return { ...t, byCategory: totals };
  });
  const entries = pending
    .map(({ id, date, amount, category }) => ({ id, date, amount, category, memo: '', pending: true }))
    .concat(data.entries)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  return {
    ...data,
    spent: data.spent + sum,
    variable: data.variable + sum,
    balance: data.balance == null ? null : data.balance - sum,
    byCategory,
    trend,
    entries,
  };
}

// 円グラフとリストの並び：金額の多い順、「その他」は最後。割合は使った額（固定費を除く）に対して。
export function shares(data) {
  const total = data.byCategory.reduce((s, c) => s + c.amount, 0);
  const sorted = data.byCategory
    .filter((c) => c.amount > 0)
    .sort((a, b) => (a.name === OTHER) - (b.name === OTHER) || b.amount - a.amount);
  return sorted.map((c) => ({ ...c, share: total ? c.amount / total : 0 }));
}

export const percent = (share) => `${(Math.round(share * 1000) / 10).toFixed(1)}%`;

// 推移の最後から2番目（前の月）の使った額。比べられないときは null。
export function previousVariable(data) {
  const prev = data.trend[data.trend.length - 2];
  return prev ? Object.values(prev.byCategory).reduce((s, v) => s + v, 0) : null;
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

// 履歴を日ごとにまとめる（端末の時刻で、新しい日が上）。
export function groupByDay(entries) {
  const days = [];
  entries.forEach((e) => {
    const d = new Date(e.date);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = { key, label: `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`, total: 0, items: [] };
      days.push(day);
    }
    day.total += e.amount;
    day.items.push(e);
  });
  return days;
}

// <input type="datetime-local"> との変換（端末の時刻）
export function toLocalInput(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(value) {
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
