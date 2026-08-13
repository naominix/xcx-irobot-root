# 複数Root版サイト

複数Root対応は、安定版の単体制御サイトとは別のGitHub Pagesサイトとして公開します。

## 公開方針

単体制御版は既存の `xcx-irobot-root` サイトを継続して使用します。複数Root版は専用リポジトリ（予定名: `xcratch-irobot-root-multi`）へ、`multi-root` ブランチの成果物だけを配置し、次のような別URLで公開します。

```text
https://naominix.github.io/xcratch-irobot-root-multi/
```

複数Root版には、複数台制御と共有ワールド型シミュレーターが含まれます。Root 1〜3などを同じCanvasに表示し、選択中のRootだけに移動・LED・音・マーカー命令を適用します。

## 利用対象

- Rootを2台以上保有しているユーザー
- 複数台のRootを同時制御する授業・展示・実験
- 実機を使わず、複数台の動きを共有シミュレーターで確認したい場合

1台だけを使う場合は、単体制御版サイトを推奨します。複数Root版は実験的機能を含むため、単体制御版と同じ安定性を保証するものではありません。

## 配布する拡張機能

複数Root版サイトは、そのサイト自身が配布する `irobotRoot.mjs` を読み込みます。単体制御版の拡張URLと混在させないでください。

```text
https://naominix.github.io/xcratch-irobot-root-multi/irobotRoot.mjs
```

## 検証済みの範囲

ユーザーによる実機検証で、Root 3台の同時接続、RootごとのLED・モーター制御、センサーイベント、個別切断後の再接続を確認済みです。自動テストとビルド検証はローカルで実行します。Web Bluetooth、Scratch Link、Scrubの実機挙動は利用環境ごとに確認してください。

## 公開手順

1. 専用リポジトリへ `multi-root` のソースと `site-multi` のサイト素材を移す。
2. `npm ci`、`npm test -- --runInBand`、`npm run build` を実行する。
3. `dist/irobotRoot.mjs` を専用サイトのルートへ配置する。
4. GitHub Pagesを専用リポジトリから公開する。

既存の単体制御版リポジトリのPages設定や公開URLは変更しません。
