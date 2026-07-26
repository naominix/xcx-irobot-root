# iRobot Root for Xcratch

<p align="center">
  <img src="assets/root-icon-selected.png" width="180" alt="iRobot Root rt1 icon">
</p>

<p align="center">
  iRobot Root rt0/rt1を、XcratchからBluetooth Low Energy（BLE）で制御する拡張機能です。
</p>

<p align="center">
  <a href="https://github.com/naominix/xcx-irobot-root/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/naominix/xcx-irobot-root/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-green.svg"></a>
  <a href="https://xcratch.github.io/"><img alt="Xcratch" src="https://img.shields.io/badge/Xcratch-extension-4C97FF"></a>
</p>

## すぐに使う

ChromeまたはEdgeで、次のリンクを開きます。

**[XcratchでiRobot Root拡張を開く](https://xcratch.github.io/editor/?extension=https%3A%2F%2Fnaominix.github.io%2Fxcx-irobot-root%2FirobotRoot.mjs%3Fv%3D1.0.0)**

拡張機能URLを手動で指定する場合は、XcratchのExtension Loaderへ次を入力します。

```text
https://naominix.github.io/xcx-irobot-root/irobotRoot.mjs
```

1. Rootの電源を入れ、接続先の端末へ近づけます。
2. Xcratchで「Rootに接続する」ブロック、または拡張カテゴリ横のオレンジ色の接続ボタンを押します。
3. 一覧から接続するRootを選択します。
4. LEDや音などの安全な命令から動作を確認します。

> [!CAUTION]
> モーター命令を初めて試すときは、Rootを広い床へ置くか車輪を浮かせ、低速から確認してください。

## 対応環境

| 環境 | 接続方法 | 必要なもの |
|---|---|---|
| Windows / macOS / ChromeOS | Web Bluetooth | ChromeまたはEdge |
| macOS / Windows | Scratch Link | Scratch Link 2.xを起動 |
| iPadOS | App Store版ScrubのCoreBluetoothブリッジ | Scratch Link対応マーカーを持つエディター |

> [!IMPORTANT]
> **App Store版Scrubは無改造で利用できます。** 2026年7月26日、micro:bit More専用エディター上でRootとmicro:bit More v2を同時接続し、micro:bitのボタンからRootのLEDを制御できることを確認しました。

iPadOSのSafari単体では接続できません。また、接続先ページにはScrubが認識する`scratch-link-extension-script`マーカーが必要です。現在の公式Xcratchエディターはこの条件を満たさないため、Xcratch側の対応またはマーカー追加版のホスティングが必要です。詳しくは[Scrub導入手順](docs/SCRUB.md)と[Xcratch対応案](docs/XCRATCH_SCRUB.md)を参照してください。

Rootは複数の端末へ同時接続できません。接続できない場合は、別のiPad、PC、公式アプリなどでRootを切断してから再試行してください。

## できること

- 複数のRootを検索し、一覧から接続先を選択
- 左右モーターの速度制御、距離移動、回転、弧、停止
- マーカーと消しゴムの上げ下げ
- RGB LEDの点灯、消灯、点滅、回転
- 音程と長さを指定した発音
- バッテリー、照度、加速度の取得
- 左右バンパーのPush/Releaseと同時押しイベント
- FL/FR/RL/RRタッチセンサーのタッチ/リリースイベント
- 崖センサー、バッテリー関連イベント
- Root BLE protocol 1.3の任意コマンドを送るrawブロック
- Scratch/Xcratchの言語設定に連動する日本語・英語表示

## ブロックの使い方

### 接続

「Rootに接続する」を実行するとデバイス一覧が開きます。接続後、「Rootは接続済み」レポーターが真になります。「Rootを切断する」で明示的に切断できます。

### 移動

左右のモーター速度を個別に指定するほか、距離、角度、半径を使った移動ブロックを利用できます。速度や距離は小さい値から試してください。

### LED・音・描画

RGB値による点灯に加え、点滅と回転アニメーションを指定できます。音は周波数と継続時間を指定します。マーカー／消しゴムは上げ下げブロックで操作します。

### センサーイベント

バンパーとタッチセンサーには、選択メニュー付きHATと、種類ごとの固定HATがあります。イベントはRootから受信したBLE通知パケットを解析して発火します。

## サンプルプロジェクト

[example.sb3](projects/example.sb3)をダウンロードし、拡張機能を読み込んだXcratchで開いてください。

## 開発

Node.js 22以降を推奨します。XcratchのScratch VMソースを隣接ディレクトリへ配置します。

```sh
git clone https://github.com/xcratch/scratch-editor.git ../scratch-editor
npm --prefix ../scratch-editor install
npm install
npm run setup-dev
npm test -- --runInBand
npm run build
```

ビルド成果物は`dist/irobotRoot.mjs`です。詳しい構成と検証方法は[開発者向けドキュメント](docs/DEVELOPMENT.md)を参照してください。

## 技術概要

- Root識別サービス: `48c5d828-ac2a-442d-97a3-0c9822b04979`
- Nordic UARTサービス: `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
- 20バイト、big-endian、packet ID、CRC-8
- PCではWeb Bluetoothを優先し、利用できない場合はScratch Linkへフォールバック
- iPadOSでは、対応マーカーによってScrubが公開する標準`Scratch.ScratchLinkSafariSocket`を優先
- 標準Socketが直接参照可能な互換環境では、Root拡張内だけのフォールバックも利用
- Bluetooth許可で最初の探索要求が失われた場合は、同じソケットで探索を再試行

実装の基礎資料として、[Xcratch公式ドキュメント](https://xcratch.github.io/docs/ja/)、[Root BLE protocol](https://github.com/PoweredBySAM/sam-root-ble-protocol)、[Scratch Link](https://github.com/scratchfoundation/scratch-link)、[Scrub](https://github.com/bricklife/Scrub)を参照しています。

## 実機検証

Root rt0実機で、次を確認済みです。

- iPadOS + App Store版ScrubでのRoot接続
- App Store版Scrub上でのRootとmicro:bit More v2の同時接続・拡張間連携
- macOSでのWeb Bluetooth接続
- モーター、LED、音、マーカー／消しゴム命令
- バンパー／タッチHATイベント

自動テストでは、拡張メタデータ、日英切り替え、CRC、モーターパケット、packet ID循環、センサーイベント判定、Scratch VMでのHATスレッド開始を検証します。

## ライセンス

[MIT License](LICENSE) © 2026 naominix

このプロジェクトはiRobotによる公式ソフトウェアではありません。iRobotおよびRootは各権利者の商標です。
