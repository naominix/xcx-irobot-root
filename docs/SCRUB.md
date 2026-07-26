# iPadOS / Scrub導入手順

iPadOSのSafariはWeb Bluetoothを提供しないため、この拡張機能をiPadで使うにはCoreBluetoothブリッジを追加したScrubの開発ビルドが必要です。

> [!IMPORTANT]
> **2026年7月26日現在、App Store版ScrubはRoot BLE接続に未対応です。** App StoreからインストールしたScrubだけでは、この拡張機能からRootを検索・接続できません。以下のパッチを適用し、XcodeからiPadへインストールした開発ビルドを使用してください。

## 必要なもの

- macOSとXcode
- iPad実機
- [bricklife/Scrub](https://github.com/bricklife/Scrub)のソース
- このリポジトリの`scrub/patches`にある3つのパッチ

## パッチを適用する

Scrubリポジトリとこのリポジトリを任意の場所へcloneします。パスの解釈違いを避けるため、最初にScrubのディレクトリへ移動してください。

```sh
git clone https://github.com/bricklife/Scrub.git
git clone https://github.com/naominix/xcx-irobot-root.git
cd Scrub
```

適用できることを確認します。

```sh
git apply --check ../xcx-irobot-root/scrub/patches/scrub-root-support.patch
git apply --check ../xcx-irobot-root/scrub/patches/scrub-bluetooth-permission.patch
git apply --check ../xcx-irobot-root/scrub/patches/scrub-root-discovery.patch
```

エラーがなければ同じ順序で適用します。

```sh
git apply ../xcx-irobot-root/scrub/patches/scrub-root-support.patch
git apply ../xcx-irobot-root/scrub/patches/scrub-bluetooth-permission.patch
git apply ../xcx-irobot-root/scrub/patches/scrub-root-discovery.patch
```

パッチが適用済みか確認するには次を実行します。

```sh
git diff --check
git diff --stat
```

## Xcodeでビルドする

1. ScrubのXcodeプロジェクトを開きます。
2. Signing & Capabilitiesで自分のTeamと一意のBundle Identifierを設定します。
3. iPadを接続し、実行先に選択します。
4. Debug構成でビルドしてiPadへインストールします。
5. 初回起動時のBluetooth利用許可を承認します。

## 接続を確認する

1. Scrubから`https://xcratch.github.io/editor/`を開きます。
2. この拡張機能を読み込みます。
3. Rootの電源を入れ、「Rootに接続する」を押します。
4. 複数台ある場合は名前を確認して選択します。
5. LED、音、マーカーなど、移動を伴わない命令から確認します。

## パッチの役割

| パッチ | 内容 |
|---|---|
| `scrub-root-support.patch` | XcratchでもScratch Link互換ソケットを公開 |
| `scrub-bluetooth-permission.patch` | Web拡張が接続する前にCoreBluetoothの許可状態を初期化 |
| `scrub-root-discovery.patch` | Rootを探索できるようBLE受信強度の許容範囲を調整 |

## よくある問題

### `patch does not apply`

Scrub側の対象ファイルが、パッチ作成時と異なる可能性があります。`git status`で未コミット変更がないことを確認し、対象行を比較してください。既に同じ変更が入っている場合、そのパッチは重ねて適用しません。

### パッチファイルが見つからない

`git -C work/Scrub apply relative/path.patch`の相対パスは、現在のシェルではなくScrub側から解釈される場合があります。この手順のように`cd Scrub`してから`../xcx-irobot-root/...`を指定するか、絶対パスを使用してください。

### Rootが一覧に出ない

- Rootが別の端末やアプリへ接続されていないか確認します。
- RootとiPadを近づけます。
- ScrubのBluetooth許可を確認します。
- Xcodeコンソールで`[Scrub BLE] Scan started`とRootの広告名が出るか確認します。

### 接続できるが命令が動かない

最新版の`irobotRoot.mjs`を読み込んでいるか確認し、URLへバージョン用クエリを付けてキャッシュを更新します。

```text
https://naominix.github.io/xcx-irobot-root/irobotRoot.mjs?v=1.0.0
```
