# KOZENI

電卓のように金額を打ってカテゴリを押すだけの家計簿。スプシ「KOZENI__DB用」を DB にし、ブラウザ（PWA）は画面だけを持つ。

```
iPhone / PC のブラウザ（web/）
   │  端末内の未送信キュー（5秒の取り消し期間のあと、まとめて送る）
   │  POST（text/plain の JSON ＋ 合言葉）
   ▼
GAS ウェブアプリ（gas/Code.gs）
   ▼
スプシ（expenses / categories / fixed_costs / incomes / summary）
```

| 場所 | 中身 |
|---|---|
| `gas/Code.gs` | スプシに紐づける Apps Script。窓口は `add`・`addBatch`・`state` |
| `web/index.html`・`app.js` | 入力画面（電卓・カテゴリ・取り消し・設定） |
| `web/calc.js` | 電卓の入力（数字・00・+・⌫・C） |
| `web/store.js` | 端末内の保存（設定・前回の状態・未送信キュー） |
| `web/api.js` | GAS の呼び出し |
| `web/sw.js` | Service Worker。画面のファイルを端末に置き、電波がなくても開ける |
| `dev/` | 手元確認用。GAS を模擬スプシの上で動かすテスト・サーバ・PWA 確認 |

## 使い方

1. 金額を打つ（`+` で足し算もできる。例：1200 + 330）
2. カテゴリを押す → その場で記録され、上の「今月の支出」に足される
3. 5秒以内なら「取り消す」で消せる。5秒たつと裏でスプシに送る
4. 電波がない・GAS が遅いときは端末に残り、右上に「未送信 n件」と出る。開き直したときや電波が戻ったときに自動で送る（設定画面の「今すぐ送る」でも送れる）

右上の表示：「同期済み」＝全部スプシに届いた／「未送信 n件」＝送る前か送信待ち／「合言葉が違います」「送信できません（…）」＝設定か GAS を直す必要がある。

## 手元で確かめる

```bash
node --test dev/test.mjs dev/web.test.mjs
```

```bash
DELAY_MS=2500 node dev/server.mjs
```

`http://localhost:8788` を開き、設定に URL `http://localhost:8788/api`、合言葉 `dev-token`（`dev/fixture.json`）を入れる。

- `DELAY_MS` で GAS の遅さを真似る（実測は 2.5〜3.5秒）
- `curl 'localhost:8788/api/_offline?on=1'` で通信断、`on=0` で戻る
- 模擬スプシの中身は `http://localhost:8788/api/_sheets`
- `node dev/pwa-check.mjs` で、ヘッドレス Chrome に Service Worker が入り、電波なしでも開けるかを確かめる（サーバを起動した状態で実行。Claude デスクトップアプリ内のブラウザは Service Worker を登録できないため）

## 本番に出す手順

GAS を先に直し、そのあと画面を出す。逆順でも記録は端末に残り、GAS を直した後に開き直せば送られる。

1. **GAS**：Apps Script エディタで `コード.gs` を `gas/Code.gs` の中身で置き換えて保存 →「デプロイ」→「デプロイを管理」→ 鉛筆アイコン → バージョン「新バージョン」→「デプロイ」。**「新しいデプロイ」は使わない**（URL が変わり、端末の設定が全部無効になる）。`setupToken` も実行しない。
2. **画面**：main に push すると GitHub Actions が `web/` を Pages に公開する。
3. **iPhone**：ホーム画面の KOZENI を開く。Service Worker は「まず手元のファイルを出し、裏で新しいものを取ってくる」ので、更新は**次に開いたとき**に反映される（反映されないときは一度アプリを完全に閉じて開き直す）。

## Phase 1（完了）：iPhone からスプシまで1件通す

スプシに GAS を付ける手順。もう一度やり直すときだけ使う。

1. スプシ「KOZENI__DB用」で「拡張機能」→「Apps Script」。プロジェクト名を `KOZENI` にする。
2. 「プロジェクトの設定」で「『appsscript.json』マニフェスト ファイルをエディタで表示する」にチェック。
3. `コード.gs` を `gas/Code.gs`、`appsscript.json` を `gas/appsscript.json` で置き換えて保存。
4. `setupToken` を1回だけ実行し、実行ログの64文字（合言葉）を控える。「Google はこのアプリを確認していません」と出たら「詳細」→「KOZENI（安全ではないページ）に移動」→「許可」。
5. 「デプロイ」→「新しいデプロイ」→ ウェブアプリ。実行ユーザー：自分、アクセスできるユーザー：全員。出てきた `…/exec` の URL を控える。
6. iPhone で Pages を開いて「ホーム画面に追加」し、**ホーム画面から開いた状態で**設定に URL と合言葉を入れる（Safari のタブとは保存場所が別）。

## うまくいかないとき

| 表示 | 原因と直し方 |
|---|---|
| 合言葉が違います | 実行ログの64文字をもう一度コピーして設定に入れ直す |
| 送信できません（unknown_action） | GAS が古い。上の「本番に出す手順」1 をやる |
| 送信できません（missing_sheet:… / missing_column:…） | シート名か見出しが変わっている |
| 「◯件を記録できませんでした（…unknown_category）」 | そのカテゴリの active が外れている。記録は捨てられるので入れ直す |
| カテゴリが出ない | 設定で「保存して接続を確かめる」を押す。categories の active を確かめる |
| つながりませんでした | アクセスできるユーザーが「全員」になっていない、または URL が `/exec` で終わっていない |
