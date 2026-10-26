// 電卓の入力。terms は数字の文字列の配列で、「+」で次の項に進む。
export const MAX_DIGITS = 7;
export const LIMIT = 10000000;

export const empty = () => ({ terms: [''] });

export function press(state, key) {
  const terms = state.terms.slice();
  const last = terms.length - 1;

  if (/^\d$/.test(key) || key === '00') {
    const next = (terms[last] + key).replace(/^0+/, '');
    if (next.length > MAX_DIGITS) return state;
    terms[last] = next;
    return { terms };
  }
  if (key === '+') {
    if (terms[last] === '') return state;
    terms.push('');
    return { terms };
  }
  if (key === 'back') {
    if (terms[last] !== '') terms[last] = terms[last].slice(0, -1);
    else if (terms.length > 1) terms.pop();
    return { terms };
  }
  if (key === 'clear') return empty();
  return state;
}

export const total = (state) => state.terms.reduce((sum, t) => sum + (Number(t) || 0), 0);

export const yen = (n) => '¥' + n.toLocaleString('ja-JP');

// 2項以上のときだけ式を見せる（例：「1,200 + 330」「1,200 +」）。
export function expression(state) {
  if (state.terms.length < 2) return '';
  return state.terms.map((t) => (t === '' ? '' : Number(t).toLocaleString('ja-JP'))).join(' + ').trim();
}
