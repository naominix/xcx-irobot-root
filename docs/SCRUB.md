# iPadOS / Scrub導入手順

iPadOSのSafariはWeb Bluetoothを提供しないため、Rootとの通信には[App Store版Scrub](https://apps.apple.com/jp/app/scrub/id1569777095)が内蔵するScratch Link / CoreBluetoothブリッジを使用します。Scrubへのソースコードパッチは不要です。

## 実機検証

2026年7月26日、App Storeから再インストールしたScrubで次を確認しました。

- micro:bit More v2専用エディターからRootへ接続
- Rootとmicro:bit More v2を同時接続
- micro:bitのボタンイベントからRootのLEDを点灯
- Rootの命令ブロックとセンサーイベントを利用

検証したRoot拡張はコミット`97262b4`の`irobotRoot.mjs`です。

## Webエディター側の必要条件

Scrubは、ページの初期HTMLに次の要素がある場合に標準Scratch Link Socketを公開します。

```html
<script id="scratch-link-extension-script"></script>
```

micro:bit More専用エディターはこの条件を満たすため、無改造のApp Store版ScrubでRootとmicro:bit Moreが共存します。

2026年7月26日現在、公式Xcratchエディターはこのマーカーを持たないため、App Store版Scrubから標準Scratch Link Socketを利用できません。これはScrubやRoot BLEプロトコルの問題ではなく、Webエディター側の統合条件です。

## 現在の検証方法

1. App StoreからScrubをインストールします。
2. ScrubでScratch Link対応マーカーを持つエディターを開きます。
3. Root拡張の最新MJSを読み込みます。
4. Rootの電源を入れ、「Rootに接続する」を押します。
5. 複数台ある場合は名前を確認して選択します。
6. LED、音、マーカーなど、移動を伴わない命令から確認します。

```text
https://naominix.github.io/xcx-irobot-root/irobotRoot.mjs?v=97262b4
```

## 公式Xcratchで利用するには

Xcratchの初期HTMLへ標準マーカーを追加する必要があります。Xcratch本体への提案、またはマーカー追加版XcratchをGitHub Pagesへ配置する方法が考えられます。詳細は[XcratchとScrubの統合案](XCRATCH_SCRUB.md)を参照してください。

## よくある問題

### Scratch Linkのインストール案内が表示される

Scrub内でこの案内が表示される場合、開いているWebエディターが`scratch-link-extension-script`マーカーを持たず、Scrub Socketが公開されていません。PC版Scratch LinkをインストールしてもiPadOSでは解決しません。

### Rootが一覧に出ない

- Rootが別の端末やアプリへ接続されていないか確認します。
- RootとiPadを近づけます。
- iPadOSの設定でScrubのBluetooth許可を確認します。
- Rootの電源を入れ直し、デバイス一覧を更新します。

### 接続できるが命令が動かない

最新版の`irobotRoot.mjs`を読み込んでいるか確認し、URLへ異なるコミットIDを付けてキャッシュを更新します。
