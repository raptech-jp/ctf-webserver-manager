# CTF Webserver Manager

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

### インスタンスについて

- 1つのChallengeに対してインスタンスは1つのみです。

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

## MySQL (CTF問題用DB)

ChallengeのDBを `mysql` にすると、インスタンス起動時にMySQLコンテナが起動します。
ZIPに `db/init.sql` があれば初期データとして自動投入されます。
認証情報は **Settings画面** で変更できます。

```
your-challenge.zip
├─ index.php / index.html / app.py など
└─ db/
   └─ init.sql
```

### MySQL接続情報

- Host: `db`
- User: Settings画面の `Username`
- Password: Settings画面の `Password` (Usernameが`root`の場合はRoot Passwordと同一)
- Database: Settings画面の `Database`

実際に使われた値は `./.appdata/ctf-web-launcher/storage/workdirs/<instance_id>/secrets.json` に保存されます。

## データ保存先

- このディレクトリ内に保存されます

## 環境変数

- `NEXT_PUBLIC_AGENT_URL`: WebからアクセスするAgent URL
- `WEB_ORIGIN`: AgentのCORS許可Origin (カンマ区切り)
- `AGENT_HOST` / `AGENT_PORT`: Agentの待ち受け

## 既知の制約

- サブドメイン/パス公開は未対応（ホストポートのみ）
- Flaskのエントリポイントは `app.py` 固定
- Docker と `docker compose` がローカルに必要
