# 開発者向けドキュメント

## 構成

```text
src/vm/extensions/block/
  index.js            Scratchブロック、HAT、翻訳、接続管理
  root-ble.js         Rootパケット生成・解析、BLEトランスポート
  block-icon.png      ブロック用アイコン
src/gui/lib/libraries/extensions/entry/
  index.jsx           Xcratch拡張ライブラリエントリ
  translations.json  拡張一覧の日英翻訳
test/unit/            プロトコル・HAT・翻訳テスト
projects/example.sb3  サンプルプロジェクト
scrub/patches/        BLESession修正とRoot専用Xcratchブリッジ
dist/irobotRoot.mjs   配布用ES Module
```

## 開発環境

この拡張はXcratchのScratch VMソースを参照します。リポジトリと`scratch-editor`を隣接させてください。

```text
workspace/
  xcx-irobot-root/
  scratch-editor/
```

```sh
git clone https://github.com/xcratch/scratch-editor.git
git clone https://github.com/naominix/xcx-irobot-root.git
npm --prefix scratch-editor install
cd xcx-irobot-root
npm install
npm run setup-dev
```

`setup-dev`は`src/vm`内にScratch VMへのシンボリックリンクを作成します。別の配置を使う場合はScratch VMのパスを引数で渡せます。

```sh
npm run setup-dev -- /absolute/path/to/scratch-vm
```

## コマンド

```sh
npm test -- --runInBand
npm run build
npm run watch
```

## テスト範囲

- Root BLE protocol 1.3の20バイトパケット
- CRC-8とpacket ID循環
- 仕様書掲載モーターパケット
- Web Bluetooth / Scratch Linkトランスポート選択
- Base64変換のブラウザ互換性
- バンパー、タッチ、崖、バッテリーイベント
- Scratch VM `startHats`によるHATスレッド開始
- 日本語／英語ブロック、メニュー、HAT表示

## 配布

`main`へpushするとGitHub Actionsがテストとビルドを実行し、GitHub Pagesへ次を公開します。

```text
https://naominix.github.io/xcx-irobot-root/
https://naominix.github.io/xcx-irobot-root/irobotRoot.mjs
https://naominix.github.io/xcx-irobot-root/example.sb3
```

## BLE定数

```text
Root identifier service: 48c5d828-ac2a-442d-97a3-0c9822b04979
UART service:            6e400001-b5a3-f393-e0a9-e50e24dcca9e
UART RX/write:           6e400002-b5a3-f393-e0a9-e50e24dcca9e
UART TX/notify:          6e400003-b5a3-f393-e0a9-e50e24dcca9e
```

命令送信はWrite Without Responseを使用します。Scratchの命令ブロックはBLE応答待ちでUIを停止させず、通知パケットはイベントとセンサーレポーターへ反映します。

## 参考資料

- [Xcratch documentation](https://xcratch.github.io/docs/ja/)
- [PoweredBySAM/sam-root-ble-protocol](https://github.com/PoweredBySAM/sam-root-ble-protocol)
- [Scratch Link](https://github.com/scratchfoundation/scratch-link)
- [Scrub](https://github.com/bricklife/Scrub)
