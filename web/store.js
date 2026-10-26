// 端末内の保存：設定・最後に受け取った状態・未送信キュー。
// localStorage が使えない（プライベートブラウズ等）ときはメモリだけで動く。
export const HOLD_MS = 5000;

const KEYS = { config: 'kozeni.config', state: 'kozeni.state', queue: 'kozeni.queue', month: 'kozeni.month' };

export function monthOf(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function safeStorage(storage) {
  const mem = new Map();
  return {
    get(key) {
      try {
        const v = storage && storage.getItem(key);
        if (v != null) return JSON.parse(v);
      } catch {}
      return mem.has(key) ? mem.get(key) : null;
    },
    set(key, value) {
      mem.set(key, value);
      try { storage && storage.setItem(key, JSON.stringify(value)); } catch {}
    },
  };
}

export function createStore({ storage, now = () => Date.now(), uuid = () => crypto.randomUUID() } = {}) {
  const s = safeStorage(storage);
  let queue = s.get(KEYS.queue) || [];
  const save = () => s.set(KEYS.queue, queue);

  return {
    config: () => s.get(KEYS.config) || {},
    setConfig: (config) => s.set(KEYS.config, config),
    cached: () => s.get(KEYS.state),
    setCached: (state) => s.set(KEYS.state, state),
    // 最後に開いた「今月」の月データ。電波がなくても履歴とまとめをすぐ出すため。
    cachedMonth: () => s.get(KEYS.month),
    setCachedMonth: (data) => s.set(KEYS.month, data),

    queue: () => queue.slice(),

    // 記録はまず端末に置き、HOLD_MS の間は取り消せる。過ぎたら送ってよい。
    enqueue(amount, category) {
      const t = now();
      const entry = { id: uuid(), date: new Date(t).toISOString(), amount, category, holdUntil: t + HOLD_MS };
      queue.push(entry);
      save();
      return entry;
    },

    undo(id) {
      const i = queue.findIndex((e) => e.id === id && now() < e.holdUntil);
      if (i === -1) return false;
      queue.splice(i, 1);
      save();
      return true;
    },

    sendable: () => queue.filter((e) => now() >= e.holdUntil),

    // まだ取り消し期間中の記録のうち、いちばん早く送れるようになるまでのミリ秒。なければ null。
    nextReleaseIn() {
      const held = queue.filter((e) => now() < e.holdUntil);
      return held.length ? Math.min(...held.map((e) => e.holdUntil)) - now() : null;
    },

    remove(ids) {
      const drop = new Set(ids);
      queue = queue.filter((e) => !drop.has(e.id));
      save();
    },

    // サーバの今月合計（前回受け取った分）に、まだ届いていない今月の記録を足す。
    spentThisMonth() {
      const month = monthOf(now());
      const cached = s.get(KEYS.state);
      const base = cached && cached.month === month ? cached.spent : 0;
      return base + queue.filter((e) => monthOf(e.date) === month).reduce((sum, e) => sum + e.amount, 0);
    },
  };
}
