// まとめ画面：残り・カテゴリ別の円グラフ・固定費、カテゴリを押したときの詳細。
import { yen } from './calc.js';
import { shares, percent, previousVariable, colorOf, FIXED_CATEGORY, GRAY, groupByDay } from './month.js';

const SVG = 'http://www.w3.org/2000/svg';
const R = 78;
const WIDTH = 26;
const GAP = 2.5;

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n).toLocaleString('ja-JP');

export function renderSummary(root, data, ctx) {
  root.textContent = '';
  if (ctx.selected) renderDetail(root, data, ctx);
  else renderOverview(root, data, ctx);
}

function renderOverview(root, data, { onSelect }) {
  const hero = el('section', 'hero');
  hero.append(el('div', 'label', 'この月の残り'));
  if (data.balance == null) {
    hero.append(el('div', 'big muted', '—'));
    hero.append(el('div', 'sub', data.startMonth ? `開始月（${data.startMonth}）より前の月です` : 'summary に開始月がありません'));
  } else {
    hero.append(el('div', 'big', yen(data.balance)));
    hero.append(el('div', 'sub', `収入 ${data.income.toLocaleString('ja-JP')} + 繰越 ${data.carryover.toLocaleString('ja-JP')} − 支出 ${data.spent.toLocaleString('ja-JP')}`));
  }
  root.append(hero);

  const parts = shares(data);
  const prev = previousVariable(data);
  root.append(donut(parts, data, prev, onSelect));

  const legend = el('section', 'legend');
  parts.forEach((p) => {
    const row = el('button', 'legend-row');
    row.setAttribute('aria-label', `${p.name} ${yen(p.amount)} ${percent(p.share)}`);
    const dot = el('span', 'dot');
    dot.style.background = colorOf(p.name, data.categories);
    row.append(dot, el('span', 'grow', p.name), el('span', '', yen(p.amount)), el('span', 'pct', percent(p.share)));
    row.addEventListener('click', () => onSelect(p.name));
    legend.append(row);
  });
  root.append(legend);

  const fixed = data.entries.filter((e) => e.category === FIXED_CATEGORY);
  const fixedBox = el('section', 'fixed');
  const head = el('button', 'fixed-head');
  head.setAttribute('aria-expanded', 'false');
  head.append(el('span', 'grow', `固定費（${fixed.length}件）`), el('span', '', yen(data.fixed)));
  const list = el('div', 'fixed-list');
  list.hidden = true;
  fixed.forEach((e) => {
    const row = el('div', 'fixed-row');
    row.append(el('span', 'grow', e.memo || '（名前なし）'), el('span', '', yen(e.amount)));
    list.append(row);
  });
  head.addEventListener('click', () => {
    list.hidden = !list.hidden;
    head.setAttribute('aria-expanded', String(!list.hidden));
  });
  fixedBox.append(head, list);
  if (fixed.length) root.append(fixedBox);

  if (data.incomes && data.incomes.length) {
    const inc = el('section', 'fixed');
    inc.append(el('div', 'section-label', '収入'));
    data.incomes.forEach((i) => {
      const row = el('div', 'fixed-row');
      row.append(el('span', 'grow', i.name), el('span', '', yen(i.amount)));
      inc.append(row);
    });
    root.append(inc);
  }
}

// ドーナツは線の破線（stroke-dasharray）で切れ目を作る。12時から時計回り。
function donut(parts, data, prev, onSelect) {
  const wrap = el('section', 'donut');
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 200 200');
  svg.setAttribute('width', '200');
  svg.setAttribute('height', '200');
  svg.setAttribute('role', 'img');
  const total = parts.reduce((s, p) => s + p.amount, 0);
  svg.setAttribute('aria-label', total
    ? `使った額のカテゴリ別内訳。${parts.map((p) => `${p.name} ${percent(p.share)}`).join('、')}`
    : 'まだ記録がありません');

  const circ = 2 * Math.PI * R;
  const ring = (color, len, offset) => {
    const c = document.createElementNS(SVG, 'circle');
    const attrs = {
      cx: 100, cy: 100, r: R, fill: 'none', stroke: color, 'stroke-width': WIDTH,
      'stroke-dasharray': `${Math.max(len, 0.1)} ${circ}`, 'stroke-dashoffset': -offset, transform: 'rotate(-90 100 100)',
    };
    Object.entries(attrs).forEach(([k, v]) => c.setAttribute(k, v));
    svg.append(c);
    return c;
  };

  if (total === 0) {
    ring(GRAY, circ, 0).setAttribute('opacity', '0.25');
  } else {
    let offset = 0;
    parts.forEach((p) => {
      const len = p.share * circ;
      const seg = ring(colorOf(p.name, data.categories), parts.length > 1 ? len - GAP : len, offset);
      seg.style.cursor = 'pointer';
      seg.addEventListener('click', () => onSelect(p.name));
      offset += len;
    });
  }

  const center = el('div', 'donut-center');
  center.append(el('span', 'small', '使った額'), el('span', 'mid', yen(total)));
  if (prev != null && total > 0) center.append(el('span', 'small', `先月より ${signed(total - prev)}`));
  if (total === 0) center.append(el('span', 'small', 'まだ記録がありません'));
  wrap.append(svg, center);
  return wrap;
}

function renderDetail(root, data, { selected, onBack, onEdit, monthName }) {
  const parts = shares(data);
  const part = parts.find((p) => p.name === selected) || { name: selected, amount: 0, count: 0, share: 0 };
  const color = colorOf(selected, data.categories);

  const back = el('button', 'back', '‹ まとめ');
  back.addEventListener('click', onBack);
  root.append(back);

  const title = el('div', 'detail-title');
  const dot = el('span', 'dot');
  dot.style.background = color;
  title.append(dot, el('span', 'name', selected), el('span', 'small', monthName));
  root.append(title);
  root.append(el('div', 'detail-amount', yen(part.amount)));
  root.append(el('div', 'small', `使った額の ${percent(part.share)}・${part.count}件`));

  // 推移：今月だけ色、過去は灰色。押した棒の金額を上に出す。
  const months = data.trend.map((t) => ({ month: t.month, value: t.byCategory[selected] || 0 }));
  const max = Math.max(1, ...months.map((m) => m.value));
  const caption = el('div', 'small trend-caption');
  const showCaption = (m) => { caption.textContent = `${Number(m.month.slice(5))}月 ${yen(m.value)}`; };
  showCaption(months[months.length - 1]);
  const bars = el('div', 'bars');
  const labels = el('div', 'bar-labels');
  months.forEach((m, i) => {
    const colEl = el('button', 'bar-col');
    colEl.setAttribute('aria-label', `${Number(m.month.slice(5))}月 ${yen(m.value)}`);
    const bar = el('span', 'bar');
    bar.style.height = `${Math.round((m.value / max) * 100)}%`;
    bar.style.background = i === months.length - 1 ? color : 'var(--bar-past)';
    colEl.append(bar);
    colEl.addEventListener('click', () => showCaption(m));
    bars.append(colEl);
    labels.append(el('span', '', `${Number(m.month.slice(5))}月`));
  });
  const trend = el('section', 'trend');
  trend.append(el('div', 'section-label', '6か月の推移'), caption, bars, labels);
  root.append(trend);

  const entries = data.entries.filter((e) => e.category === selected);
  const list = el('section', 'detail-list');
  list.append(el('div', 'section-label', 'この月の記録'));
  if (entries.length === 0) list.append(el('div', 'empty', '記録はありません'));
  groupByDay(entries).forEach((day) => {
    day.items.forEach((e) => {
      const row = el('button', 'entry');
      row.append(el('span', 'entry-name', day.label), el('span', 'entry-right', e.pending ? `送信待ち ${yen(e.amount)}` : yen(e.amount)));
      if (e.pending) row.disabled = true;
      else row.addEventListener('click', () => onEdit(e));
      list.append(row);
    });
  });
  root.append(list);
}
