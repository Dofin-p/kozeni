// GAS 窓口の呼び出し。text/plain にして CORS の事前確認を起こさない（GAS は OPTIONS に応答できない）。
export class ApiError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// 通信の失敗と、GAS が混んでいるときだけは、待てば通る見込みがある。
export const isRetryable = (err) => !(err instanceof ApiError) || err.code === 'busy';

export async function call({ url, token }, action, data, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token, data }),
      signal: ctrl.signal,
    });
    const json = await res.json();
    if (!json.ok) throw new ApiError(json.error || 'unknown');
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}
