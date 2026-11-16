// まとめ画面から収入を足す・直す・消すシート。
import { yen } from './calc.js';
import { monthLabel } from './month.js';

const $ = (id) => document.getElementById(id);

// 金額欄の「45,000」「４５０００」などを整数にする。数字でなければ NaN。
export function parseAmount(text) {
  const half = String(text).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const s = half.replace(/[,，\s円¥]/g, '');
  return /^\d+$/.test(s) ? Number(s) : NaN;
}

// 入力を確かめて、送る形にする。だめなら { error } を返す。
export function incomeFields(name, amountText) {
  const n = String(name).trim();
  const amount = parseAmount(amountText);
  if (n === '') return { error: '名前を入れてください（仕送り・バイトなど）' };
  if (n.length > 20) return { error: '名前は20文字までにしてください' };
  if (!Number.isInteger(amount) || amount <= 0 || amount >= 10000000) return { error: '金額は1円以上・1,000万円未満の整数で入れてください' };
  return { name: n, amount };
}

// 同じ月に同じ名前の収入がもうあれば、その行を返す（足すと2行になることを知らせる）。
export function sameNameIn(existing, name, selfId) {
  const n = String(name).trim();
  return (existing || []).find((i) => i.name === n && i.id !== selfId) || null;
}

// income が null なら新しく足す。suggestions は [{ name, amount }]（新しい月に使った順）。existing はその月の収入。
export function openIncomeEditor({ income, month, suggestions, existing }, { onSave, onDelete }) {
  let confirming = false;
  $('incomeTitle').textContent = income ? '収入を直す' : `${monthLabel(month)}の収入を足す`;
  $('incomeName').value = income ? income.name : '';
  $('incomeAmount').value = income ? String(income.amount) : '';
  $('incomeDelete').hidden = !income;
  $('incomeDelete').textContent = '削除';
  const note = (text, tone = '') => { $('incomeNote').textContent = text; $('incomeNote').className = `note ${tone}`; };
  note('');

  // 候補を押すと名前が入り、金額が空なら前回の金額も入る（毎月同じ額ならそのまま保存）
  const chips = $('incomeNames');
  chips.textContent = '';
  (income ? [] : suggestions || []).forEach((s) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = s.name;
    chip.title = `前回 ${yen(s.amount)}`;
    chip.addEventListener('click', () => {
      $('incomeName').value = s.name;
      if ($('incomeAmount').value.trim() === '') $('incomeAmount').value = String(s.amount);
      $('incomeAmount').focus();
      $('incomeAmount').select();
      warnSame();
    });
    chips.append(chip);
  });
  $('incomeNamesLabel').hidden = chips.childElementCount === 0;

  // 名前が同じ月の別の行と重なったら、保存の前に知らせる（止めはしない）
  const warnSame = () => {
    const dup = sameNameIn(existing, $('incomeName').value, income && income.id);
    note(dup ? `この月にはもう「${dup.name}」（${yen(dup.amount)}）があります。保存すると2行になります` : '', dup ? 'warn' : '');
  };
  $('incomeName').oninput = warnSame;

  const busy = (on) => { $('incomeSave').disabled = on; $('incomeDelete').disabled = on; };
  const close = () => { $('incomeSheet').hidden = true; };

  $('incomeSave').onclick = async () => {
    const fields = incomeFields($('incomeName').value, $('incomeAmount').value);
    if (fields.error) return note(fields.error, 'ng');
    if (income && fields.name === income.name && fields.amount === income.amount) return close();
    busy(true);
    note('保存しています…');
    const error = await onSave({ id: income ? income.id : null, month, ...fields });
    busy(false);
    if (error) note(error, 'ng');
    else close();
  };

  // 削除は2回押しで確定する
  $('incomeDelete').onclick = async () => {
    if (!confirming) {
      confirming = true;
      $('incomeDelete').textContent = 'もう一度押すと削除します';
      return;
    }
    busy(true);
    note('削除しています…');
    const error = await onDelete(income);
    busy(false);
    if (error) note(error, 'ng');
    else close();
  };

  $('incomeClose').onclick = close;
  $('incomeSheet').hidden = false;
  if (!income && chips.childElementCount === 0) $('incomeName').focus();
}
