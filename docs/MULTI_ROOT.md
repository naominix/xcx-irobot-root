# 複数Root版サイト

複数Root対応は、安定版の単体制御サイトとは別のGitHub Pagesサイトとして公開します。

## 公開方針

単体制御版は既存の `xcx-irobot-root` サイトを継続して使用します。複数Root版は専用リポジトリ（予定名: `xcratch-irobot-root-multi`）へ、`multi-root` ブランチの成果物だけを配置し、次のような別URLで公開します。

```text
https://naominix.github.io/xcratch-irobot-root-multi/
```

複数Root版は実機の複数台制御に対応します。シミュレーターは選択したRootを1台だけ表示し、その番号を画面に示します。

## 利用対象

- Rootを2台以上保有しているユーザー
- 複数台のRootを同時制御する授業・展示・実験
- 実機を使わず、選択したRootの動きをシミュレーターで確認したい場合

1台だけを使う場合は、単体制御版サイトを推奨します。複数Root版は実験的機能を含むため、単体制御版と同じ安定性を保証するものではありません。

## 配布する拡張機能

複数Root版サイトは、そのサイト自身が配布する `irobotRoot.mjs` を読み込みます。単体制御版の拡張URLと混在させないでください。

```text
https://naominix.github.io/xcratch-irobot-root-multi/irobotRoot.mjs
```

## 検証済みの範囲

以前のマルチ版では、Root 3台の同時接続、RootごとのLED・モーター制御、センサーイベント、個別切断後の再接続を実機で確認しています。今回の最新版を統合した実装は、Web Bluetooth、Scratch Link、Scrubの各環境で再検証が必要です。

## 公開手順

1. 専用リポジトリへ `multi-root` のソースと `site-multi` のサイト素材を移す。
2. `npm ci`、`npm test -- --runInBand`、`npm run build` を実行する。
3. `dist/irobotRoot.mjs` を専用サイトのルートへ配置する。
4. GitHub Pagesを専用リポジトリから公開する。

既存の単体制御版リポジトリのPages設定や公開URLは変更しません。
