# CTF Web Launcher (MVP)

CTF Web問題をGUIで簡単に起動・停止できるローカルランチャーです。ZIPを登録し、ランタイムとDBを選ぶと空きポートを割り当ててDocker Composeで起動します。

## リポジトリ構成

- `apps/web`: Next.js (App Router) UI
- `apps/agent`: Fastify + SQLite のローカルAgent
- `templates/`: Docker Compose / Dockerfile テンプレート
- `packs/examples/`: サンプル問題
- `scripts/`: 起動スクリプト

## 必要要件

- Node.js 20 以上
- pnpm
- Docker Desktop / Docker Engine + `docker compose`

## セットアップ

```bash
pnpm install
pnpm dev
```

- Web: `http://localhost:3000`
- Agent: `http://127.0.0.1:43765`

macOS/Linux では `scripts/dev.sh`、Windows では `scripts/dev.ps1` も利用できます。

## 使い方

1. Web画面の **New Challenge** からZIPとメタデータを登録
1. **Start New** でインスタンスを起動
1. **Open** で `http://127.0.0.1:<host_port>/` を開く
1. **Logs** でログを確認、**Stop** で停止
1. **Delete** でインスタンスを削除
1. **Export** で challenge-pack.zip を出力

### インスタンス仕様

- 1つのChallengeに対してインスタンスは1つのみです。
- 起動中はStartが無効になります。

### ZIPの配置ルール (PHP)

- ZIP内の内容は `/var/www/html` 直下に展開されます。
- ZIP内が単一のトップディレクトリ構成の場合は自動でフラット化します。
- PHP(Apache) では `index.html` または `index.php` が直下に無いと登録に失敗します。

### インポート

- **Import Pack** から `challenge-pack.zip` をアップロード
- `manifest.json` が無い場合は、UIでランタイム等を入力してから登録

## サンプル問題

- `packs/examples/php-hello`
- `packs/examples/flask-hello`

例: サンプルをZIP化して登録

```bash
cd packs/examples/php-hello
zip -r ../../php-hello.zip .
```

## challenge-pack.zip の構造

```
manifest.json
files/
  ...
  db/init.sql (任意)
```

`manifest.json` はAgentが生成します。

## データ保存先

AgentはOSごとのアプリデータ配下に保存します。

- macOS: `~/Library/Application Support/ctf-web-launcher`
- Windows: `%APPDATA%\ctf-web-launcher`
- Linux: `~/.local/share/ctf-web-launcher` (または `XDG_DATA_HOME`)

## 環境変数

- `NEXT_PUBLIC_AGENT_URL`: WebからアクセスするAgent URL
- `WEB_ORIGIN`: AgentのCORS許可Origin (カンマ区切り)
- `AGENT_HOST` / `AGENT_PORT`: Agentの待ち受け

## 既知の制約

- サブドメイン/パス公開は未対応（ホストポートのみ）
- Flaskのエントリポイントは `app.py` 固定
- Docker と `docker compose` がローカルに必要
