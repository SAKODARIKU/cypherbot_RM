# RM定例 Slack自動投稿ボット

RM定例の「議事録リンク」と「Meetリンク」を、決まった曜日・時刻にSlackへ自動投稿するボットです。

- 議事録リンク・Meetリンクは、どちらも**固定値**として設定します(同じものを使い回す前提)
- GitHub Actionsで完全無料・サーバー不要でスケジュール実行します
- 特定の個人のGoogleアカウントやClaudeアカウントには依存しません。このリポジトリへのアクセス権を持つ人なら誰でも引き継いで管理できます

## 全体の流れ

セットアップさえ済ませてしまえば、あとは何もしなくても決まった時刻に自動でRM本番チャンネルへ整形されたメッセージが投稿されます。人が毎回リンクを貼ったりする作業は一切不要です。

もしMeetリンクや議事録リンクが将来変わることがあれば、後述のGitHub Secretsの値を書き換えるだけで反映されます。コードを触る必要はありません。

## セットアップ手順

### 1. Slackアプリを作成する

1. https://api.slack.com/apps を開き、「Create New App」→「From scratch」を選択
2. アプリ名(例: `RM Bot`)と、投稿したいワークスペースを選んで作成
3. 左メニューの「OAuth & Permissions」を開く
4. 「Scopes」→「Bot Token Scopes」に以下を追加
   - `chat:write` (メッセージを投稿する権限。これだけで足ります)
5. ページ上部の「Install to Workspace」をクリックして許可する
6. インストール後に表示される「Bot User OAuth Token」(`xoxb-` から始まる文字列)をコピーしておく(あとで使います)

### 2. Botをチャンネルに招待する

投稿先の `#all-cypher` チャンネルで `/invite @RM Bot` (作成したアプリ名)を実行してBotを招待してください。

### 3. チャンネルIDを調べる

`#all-cypher` のチャンネル名をクリック →「詳細を表示」→ 一番下にある「チャンネルID」(`C` から始まる文字列)をコピーします。これが `RM_CHANNEL_ID` の値になります。

### 4. このリポジトリをGitHubにpushする

このフォルダの中身を、チーム/会社の共有GitHubアカウントで作成したリポジトリにpushしてください。

### 5. リポジトリにSecretsを登録する

GitHubリポジトリの `Settings` → `Secrets and variables` → `Actions` → `New repository secret` から、以下を1つずつ登録します。

| Secret名 | 値 |
|---|---|
| `SLACK_BOT_TOKEN` | 手順1でコピーした `xoxb-...` のトークン |
| `RM_CHANNEL_ID` | 手順3で調べたRM本番チャンネルのID |
| `MINUTES_URL` | 固定の議事録ドキュメントのURL |
| `MEET_URL` | 固定で使い回すMeetのURL |

### 6. 配信スケジュールを設定する

初期設定では、**毎週月曜・木曜の13:00(JST)**に投稿されるようにしてあります(`.github/workflows/post-rm.yml`内の`cron: '0 4 * * 1,4'`)。21:00開始の定例会よりだいぶ前倒しにしてあるので、事前に議事録へアジェンダを書き込みたい人の時間も確保できます。

時刻や曜日を変えたい場合は、その`cron`の行を書き換えてください。GitHub Actionsのcronは **UTC(協定世界時)** 基準なので、JSTの時刻から9時間引いた時刻を指定します。曜日はカンマ区切りで複数指定できます(月と木なら `1,4`)。

例:毎週水曜 18:00(JST)だけに変更したい場合 → `0 9 * * 3`

### 7. 動作確認する

GitHubリポジトリの「Actions」タブ →「RM定例のSlack自動投稿」ワークフローを開き、「Run workflow」ボタンから手動実行できます。RM本番チャンネルに整形されたメッセージが届くか確認してください。

#### Slackに投稿せずに中身だけ確認したいとき(ドライラン)

`DRY_RUN=1` を付けて実行すると、実際にはSlackに投稿せず、組み立てたメッセージの中身(JSON)だけを表示できます。SlackアプリをまだセットアップしていなくてもOKです(`MINUTES_URL` と `MEET_URL` だけ用意すれば動きます)。

事前に一度だけ、このフォルダ内で `npm install` を実行してください(Node.jsのインストールが必要です)。

**Mac / Linux(ターミナル、bash・zshなど)**

```bash
npm install
DRY_RUN=1 MINUTES_URL="固定の議事録URL" MEET_URL="固定のMeet URL" node post-rm-message.js
```

**Windows(PowerShell)**

PowerShellは環境変数の指定方法がbashと違うので、以下のように1行ずつ実行してください。

```powershell
npm install
$env:DRY_RUN="1"
$env:MINUTES_URL="固定の議事録URL"
$env:MEET_URL="固定のMeet URL"
node post-rm-message.js
```

出力されたJSONの `blocks` の中身を https://app.slack.com/block-kit-builder にコピーすると、実際にSlackでどう見えるかをブラウザ上でプレビューできます。

> ちなみに本番運用ではこのコマンドを手動で打つ必要は一切ありません。決まった時刻にGitHub Actions側(GitHubのクラウド上)が自動で実行してくれるので、パワーシェルもターミナルも開きっぱなしにする必要はないです。あくまで「事前に見た目を確認したいとき」だけ使うものです。

## Meetリンク・議事録リンクを変更したいとき

GitHubリポジトリの `Settings` → `Secrets and variables` → `Actions` で、`MEET_URL` または `MINUTES_URL` の値を上書きするだけで反映されます。コードを書き換える必要はありません。

## 引き継ぎ方法

このリポジトリへのアクセス権(またはこのフォルダ一式)を渡すだけで、誰でも管理を引き継げます。Slackアプリ自体もワークスペースに属しているので、特定個人のアカウントに依存しません。

引き継ぐ相手には、上記セットアップ手順1〜6を一通りやってもらう(またはあなたが作ったSlackアプリのトークンとリンクをそのまま渡す)だけで、すぐに動かせます。
