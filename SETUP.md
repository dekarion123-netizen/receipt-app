# レシート仕分け（独立版）セットアップ手順

Muse（ごま）を開かずに、スマホ・iPad・PCのブラウザから直接使える版です。
構成は日報アプリの独立版と同じで、データの置き場に Supabase（無料プラン）、
アプリの公開に GitHub Pages（無料）を使います。

用意するもの（全部このフォルダの中）：
- `index.html` / `app.js` / `style.css` / `config.js` … アプリ本体
- `schema.sql` … Supabaseに流すデータベース作成SQL

所要時間の目安：30分ほど。途中でパスワードを決める場面が2回あります
（Supabaseのログインユーザー用、GitHub用は既存アカウントがあれば不要）。

---

## 1. Supabase プロジェクトを作る

1. https://supabase.com を開き、サインアップ／ログインする
2. 「New project」を押し、以下で作成する
   - Name：`receipt-app`（何でもよい）
   - Database Password：新しいパスワードを決めて入力（自分で控えておく）
   - Region：`Northeast Asia (Tokyo)` を選ぶ
3. プロジェクトが「Active」になるまで数分待つ

## 2. データベースと写真置き場を作る（SQL実行）

1. 左メニューの「SQL Editor」を開く
2. このフォルダの `schema.sql` の中身を全部貼り付けて「Run」を押す
   - receipts テーブル、本人だけアクセスできる設定（RLS）、
     写真用バケット `receipts` が作られます
3. 左メニュー「Storage」に `receipts` バケットがあることを確認する

## 3. アプリ用ログインアカウントを作る

1. 左メニュー「Authentication」→「Users」→「Add user」
2. 普段使うメールアドレスと、自分で決めたパスワードを入れて作成する
   - このメール＋パスワードが、アプリへのログインに使うものです
   - 「Auto Confirm User」があればオンにする

## 4. アプリに接続情報を入れる

1. Supabase の左メニュー「Project Settings（歯車）」→「API」を開く
2. `Project URL` と `anon public` キーを控える
3. このフォルダの `config.js` を開き、2か所を書き換える
   - `SUPABASE_URL` ← Project URL
   - `SUPABASE_ANON_KEY` ← anon public キー
   - ※ anon key は公開前提のキーです。データ自体は手順2のRLSで
     「ログインした本人の分だけ」に守られます

## 5. GitHub に置いて公開する（GitHub Pages）

1. https://github.com でログインし、「New repository」で新規作成
   - 名前例：`receipt-app`、Public、他は既定でOK
2. このフォルダの5ファイルをアップロードする
   （`index.html` / `app.js` / `style.css` / `config.js` / `SETUP.md`。
   `schema.sql` はアップロードしなくても動作します）
   - 画面からなら「uploading an existing file」でドラッグ＆ドロップ
3. リポジトリの「Settings」→「Pages」を開く
   - Source：`Deploy from a branch`、Branch：`main` / `/ (root)` を選んで Save
4. 数分後、`https://（GitHubユーザー名）.github.io/receipt-app/` で開けるようになる

## 6. スマホ・iPadでの使い方

1. 手順3で作ったメール＋パスワードでログインする
2. iPhone / iPad：ブラウザでアプリを開き、共有ボタン →「ホーム画面に追加」
   - 次からはアイコンから全画面で開けます（ログインは初回だけ）
   - ※日報アプリの独立版は Safari で開けなかったため、問題があれば Chrome で開いてください
3. PC：同じURLをブラウザで開けば、同じデータが見られます

## 7. 写真のAI読み取り（Gemini APIキー・任意）

設定しなくても手入力で全部使えます。読み取りを使いたい場合だけ：

1. https://aistudio.google.com を開き、Googleアカウントでログイン
2. 「Get API key」→「Create API key」でキーを発行する（無料枠で使えます）
3. アプリの「設定」タブにキーを貼って保存する
   - キーは使っているブラウザの中（localStorage）にだけ保存されます
   - 送信されるのは、読み取りたいレシート写真と読み取り依頼だけです
4. 登録フォームで写真を選び、「写真をAIで読み取る」を押すと
   日付・店名・金額・品目・科目が入ります
   - 読み取り結果は必ず「未確認」の下書きになります。内容を確認して
     「確認済み」にチェックして保存してください

## 使い方メモ（仕様）

- 月の振り分けは「登録した月」ではなく「レシートの日付の月」です
  （1月の束に混ざった3月分は、自動で3月の集計に入ります）
- 科目は申告用Excel（KITAKU経費・売上集計）の2027年・2028年シートと
  同じ15科目・同じ並びです
- 「集計・転記」タブの「Excelへ転記」プレビューは、確認済みだけを集計し、
  転記先を「収入年の翌年シート」（例：2026年分→「2027年」シート）と表示します
- Excel本体への転記は、ごま側の転記スクリプトで行います
  （このアプリは転記用CSVまでを担当します）

## うまくいかないとき

- ログイン画面から進まない：`config.js` の URL と anon key の貼り間違いが
  多いです。手順4を見直してください
- 保存でエラーになる：`schema.sql` が実行できているか（手順2）、
  Storageに `receipts` バケットがあるかを確認してください
- 写真が表示されない：ログインし直すと直ることがあります
  （表示用URLの有効期限が1時間のため）
