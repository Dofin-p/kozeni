// 手元確認用のサンプルデータ。開始月を5か月前にして、半年分の支出・固定費・収入を入れる。
// SEED=1 node dev/server.mjs で使う。乱数は固定なので毎回同じデータになる。

// [カテゴリ, 週あたりの回数, 1回の最小額, 最大額]
const WEIGHTS = [['食費', 10, 300, 1500], ['日用品', 2, 200, 1500], ['ゲーム', 0.7, 1500, 9000], ['本', 1.5, 600, 2600],
  ['交通費', 3, 150, 800], ['現金引き落とし', 0.5, 3000, 10000], ['その他', 1, 300, 4000]];

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

const tokyoMonth = (d) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).format(d).slice(0, 7);
const shift = (month, n) => {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export function seed(gas) {
  const now = new Date();
  const current = tokyoMonth(now);
  const start = shift(current, -5);
  gas.sheets.summary = [['初期繰越', 100000], ['開始月', start]];
  gas.ctx.setupPhase3();

  const rand = rng(42);
  const rows = gas.sheets.expenses;
  const fixed = gas.sheets.fixed_costs.slice(1).filter((r) => r[2] === true);
  let n = 0;
  for (let i = 0; i < 6; i++) {
    const month = shift(start, i);
    const days = i === 5 ? Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', day: 'numeric' }).format(now)) : 28;
    if (i < 5) {
      fixed.forEach(([name, amount]) => rows.push([`fixed:${month}:${name}`, new Date(`${month}-01T00:00:00+09:00`), amount, '固定費', name]));
    }
    WEIGHTS.forEach(([category, perWeek, min, max]) => {
      const count = Math.round(perWeek * (days / 7) * (0.6 + rand() * 0.8));
      for (let k = 0; k < count; k++) {
        const day = 1 + Math.floor(rand() * days);
        const hour = 8 + Math.floor(rand() * 14);
        const amount = Math.round((min + rand() * (max - min)) / 10) * 10;
        const date = new Date(`${month}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00+09:00`);
        if (date > now) continue;
        rows.push([`seed-${++n}`, date, amount, category, '']);
      }
    });
    gas.sheets.incomes.push([month, '仕送り', 45000], [month, 'バイト', 50000 + Math.round(rand() * 15000)]);
  }
  return { start, rows: n };
}
