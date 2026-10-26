# KOZENI

電卓のように金額を打ってカテゴリを押すだけの家計簿。スプシ「KOZENI__DB用」を DB にし、ブラウザ（PWA）は画面だけを持つ。

```
iPhone / PC のブラウザ（web/）
   │  POST（text/plain の JSON ＋ 合言葉）
   ▼
GAS ウェブアプリ（gas/Code.gs）
   ▼
スプシ（expenses / categories / fixed_costs / incomes / summary）
```

| 場所 | 中身 |
|---|---|
| `gas/` | スプシに紐づける Apps Script。Apps Script エディタに貼る |
| `web/` | 画面。GitHub Pages に公開する（`.github/workflows/pages.yml`） |
| `dev/` | 手元確認用。GAS を模擬スプシの上で動かす |

## 手元で確かめる

```bash
node --test dev/test.mjs
```

```bash
node dev/server.mjs
```

`http://localhost:8788` を開き、設定に URL `http://localhost:8788/api`、合言葉 `dev-token`（`dev/fixture.json`）を入れる。模擬スプシの中身は `http://localhost:8788/api/_sheets` で見られる。

## Phase 1：iPhone からスプシまで1件通す

完了条件：iPhone のホーム画面から開いて「1件送る」を押すと、スプシの `expenses` に1行入る。

### A. スプシに GAS を付ける

1. スプシ「KOZENI__DB用」で「拡張機能」→「Apps Script」。プロジェクト名を `KOZENI` にする。
2. 左の歯車「プロジェクトの設定」で「『appsscript.json』マニフェスト ファイルをエディタで表示する」にチェック。
3. エディタの `コード.gs` の中身を全部消して `gas/Code.gs` を貼る。`appsscript.json` も `gas/appsscript.json` で置き換える。保存。
4. 上の関数の選択で `setupToken` を選んで「実行」。
   - 承認を求められたら自分のアカウントを選ぶ。「Google はこのアプリを確認していません」と出たら「詳細」→「KOZENI（安全ではないページ）に移動」→「許可」。自分で書いたスクリプトなのでこれで正しい。
   - 実行ログに出る64文字が合言葉。**`setupToken` は2回目以降は実行しない**（合言葉が変わり、端末の設定が全部無効になる）。
5. 「デプロイ」→「新しいデプロイ」→ 種類の歯車で「ウェブアプリ」。
   - 実行ユーザー：**自分**
   - アクセスできるユーザー：**全員**（「自分のみ」だとページから届かない。代わりに合言葉で守る）
   - 「デプロイ」→ 出てきた URL（`…/exec` で終わる）をコピー。
6. その URL を Mac のブラウザで開き、`{"ok":true,"app":"kozeni"}` と出れば公開できている。

### B. 画面を公開する

`web/` を GitHub Pages に公開する（main に push すると自動で公開される）。

### C. iPhone で1件送る

1. Pages の URL を Safari で開き、共有ボタン →「ホーム画面に追加」。
2. **ホーム画面の KOZENI から開く**。「起動のしかた」が「ホーム画面から」になっていることを確かめる。
   - ホーム画面から開いたアプリは、Safari のタブとは別に設定を保存する。設定は必ずこの状態で入れる。
3. 「設定」に GAS の URL と合言葉を入れて保存。Mac でコピーして iPhone でペーストすれば打たずに済む（ユニバーサルクリップボード）。
4. 「1件送る」を押す。「成功（○○ ms）」と出たら、その ms をメモしておく（Phase 2 で待ち時間を隠す設計の目安になる）。
5. スプシの `expenses` に1円・その他の行が入っていれば Phase 1 完了。確かめたらその行は行ごと削除する。

### うまくいかないとき

| 表示 | 原因と直し方 |
|---|---|
| `unauthorized` | 合言葉が違う。実行ログの64文字をもう一度コピーして入れ直す |
| `unknown_category` | categories の「その他」の active にチェックが入っていない |
| `missing_sheet:…` / `missing_column:…` | シート名か見出しが変わっている |
| 通信できませんでした | アクセスできるユーザーが「全員」になっていない、または URL が `/exec` で終わっていない |

## GAS を直したとき

「デプロイ」→「デプロイを管理」→ 鉛筆アイコン → バージョン「新バージョン」→「デプロイ」。**「新しいデプロイ」は使わない**（URL が変わり、端末の設定が全部無効になる）。
