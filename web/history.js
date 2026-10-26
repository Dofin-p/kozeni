// 履歴画面と、記録を直す・消すシート。
import { yen } from './calc.js';
import { groupByDay, colorOf, toLocalInput, fromLocalInput } from './month.js';

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function renderHistory(root, data, { onEdit }) {
  root.textContent = '';
  if (data.entries.length === 0) {
    root.append(el('div', 'empty', 'この月の記録はまだありません'));
    return;
  }
  groupByDay(data.entries).forEach((day) => {
    const head = el('div', 'day-head');
    head.append(el('span', '', day.label), el('span', '', yen(day.total)));
    root.append(head);
    day.items.forEach((e) => {
      const row = el('button', 'entry');
      row.setAttribute('aria-label', `${day.label} ${e.category} ${yen(e.amount)}${e.pending ? ' 送信待ち' : ''}`);
      const dot = el('span', 'dot');
      dot.style.background = colorOf(e.category, data.categories);
      const name = el('span', 'entry-name', e.category);
      if (e.memo) name.append(el('span', 'entry-memo', e.memo));
      const right = el('span', 'entry-right');
      if (e.pending) right.append(el('span', 'badge', '送信待ち'));
      right.append(el('span', 'entry-amount', yen(e.amount)));
      row.append(dot, name, right);
      if (e.pending) row.disabled = true;
      else row.addEventListener('click', () => onEdit(e));
      root.append(row);
    });
  });
}

// 記録を直すシートを開く。保存・削除は呼ぶ側が GAS に送り、失敗したら理由を返す（null なら成功）。
export function openEditor(entry, categories, { onSave, onDelete }) {
  const names = categories.includes(entry.category) ? categories : [entry.category, ...categories];
  let category = entry.category;
  let confirming = false;

  $('editAmount').value = String(entry.amount);
  $('editDate').value = toLocalInput(entry.date);
  $('editMemo').textContent = entry.memo ? `メモ：${entry.memo}` : '';
  $('editNote').textContent = '';
  $('editNote').className = 'note';
  $('editDelete').textContent = '削除';

  const chips = $('editCats');
  chips.textContent = '';
  names.forEach((name) => {
    const chip = el('button', 'chip', name);
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(name === category));
    const dot = el('span', 'dot');
    dot.style.background = colorOf(name, categories);
    chip.prepend(dot);
    chip.addEventListener('click', () => {
      category = name;
      chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    });
    chips.append(chip);
  });

  const note = (text, tone = '') => { $('editNote').textContent = text; $('editNote').className = `note ${tone}`; };
  const busy = (on) => { $('editSave').disabled = on; $('editDelete').disabled = on; };
  const close = () => { $('editSheet').hidden = true; };

  $('editSave').onclick = async () => {
    const amount = Number($('editAmount').value.replace(/[,，\s]/g, ''));
    const date = fromLocalInput($('editDate').value);
    if (!Number.isInteger(amount) || amount <= 0 || amount >= 10000000) return note('金額は1円以上・1,000万円未満の整数で入れてください', 'ng');
    if (!date) return note('日時を入れてください', 'ng');
    const patch = {};
    if (amount !== entry.amount) patch.amount = amount;
    if (category !== entry.category) patch.category = category;
    // 入力欄は分までなので、分まで同じなら日時は変えていないとみなす（秒を消さない）
    if (toLocalInput(date) !== toLocalInput(entry.date)) patch.date = date;
    if (Object.keys(patch).length === 0) return close();
    busy(true);
    note('保存しています…');
    const error = await onSave(entry, patch);
    busy(false);
    if (error) note(error, 'ng');
    else close();
  };

  // 削除は2回押しで確定する
  $('editDelete').onclick = async () => {
    if (!confirming) {
      confirming = true;
      $('editDelete').textContent = 'もう一度押すと削除します';
      return;
    }
    busy(true);
    note('削除しています…');
    const error = await onDelete(entry);
    busy(false);
    if (error) note(error, 'ng');
    else close();
  };

  $('editClose').onclick = close;
  $('editSheet').hidden = false;
}
