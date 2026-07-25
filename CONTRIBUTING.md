# Contributing

IssueやPull Requestを歓迎します。実機依存の問題では、再現条件をできるだけ具体的に記載してください。

## Issueへ含める情報

- Rootのモデル（rt0 / rt1）
- OSとバージョン
- ブラウザ、Scratch Link、またはScrubの種類とバージョン
- 拡張機能URLのバージョン
- 接続まで成功するか、どのブロックで問題が起きるか
- ブラウザコンソールまたはXcodeコンソールの関連ログ

Bluetoothアドレス、端末名など、公開したくない情報は削除してから投稿してください。

## 開発手順

[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)に従って依存関係を準備し、変更前後に次を実行してください。

```sh
npm test -- --runInBand
npm run build
```

Pull Requestには、変更理由、利用者への影響、実施したテストを記載してください。
