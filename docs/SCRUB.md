# iPadOS / Scrub導入手順

iPadOSのSafariはWeb Bluetoothを提供しないため、Rootとの通信にはScrubのCoreBluetoothブリッジを使用します。

> [!IMPORTANT]
> **2026年7月26日現在、App Store版ScrubはこのRoot BLE拡張の対応対象外です。** 以下では、scratch-linkの`BLESession.swift`修正と、公式Xcratch向けのRoot専用Socket公開だけを適用した開発ビルドを使用します。Scrub標準のSocket公開条件とCoreBluetoothの初期化時期は元のコードのままです。

## 必要なもの

- macOSとXcode
- iPad実機
- [bricklife/Scrub](https://github.com/bricklife/Scrub)のソース
- このリポジトリの`scrub/patches`にある2つのパッチ

## パッチを適用する

Scrubリポジトリとこのリポジトリを同じ親ディレクトリへcloneし、Scrubのサブモジュールを取得します。

```sh
git clone --recurse-submodules https://github.com/bricklife/Scrub.git
git clone https://github.com/naominix/xcx-irobot-root.git
cd Scrub
```

適用できることを確認してから、2つのパッチを適用します。

```sh
git apply --check ../xcx-irobot-root/scrub/patches/scrub-ble-session.patch
git apply --check ../xcx-irobot-root/scrub/patches/scrub-root-xcratch-bridge.patch
git apply ../xcx-irobot-root/scrub/patches/scrub-ble-session.patch
git apply ../xcx-irobot-root/scrub/patches/scrub-root-xcratch-bridge.patch
```

変更対象を確認します。`ScratchLink.swift`と`URL+Extension.swift`は表示されないことが重要です。

```sh
git status --short
git -C ScratchLinkKit/Sources/ScratchLinkKit/scratch-link diff --check
git -C ScratchLinkKit/Sources/ScratchLinkKit/scratch-link diff -- macOS/Sources/scratch-link/BLESession.swift
git diff -- ScratchLinkKit/Sources/ScratchLinkKit/Resources/inject.js
```

パッチが変更するのは`BLESession.swift`の次の3点だけです。

- 接続失敗をWeb側へ返し、接続待ちのままになるのを防ぐ
- `manufacturerData.dataPrefix`省略を空プレフィックスとして扱う
- 2バイト未満のmanufacturer dataを安全に拒否する

Root拡張自身はサービスUUIDで探索するため、後半2点をRoot固有の探索条件としては使用しません。これらはscratch-linkの仕様適合・安全性修正です。

`scrub-root-xcratch-bridge.patch`は、Scrub標準の`Scratch.ScratchLinkSafariSocket`とその公開条件を変更しません。公式Xcratchエディターでのみ`Scratch.iRobotRootScratchLinkSafariSocket`を追加し、Root拡張だけが参照します。他の拡張機能はこの専用名を参照しないため、Socket factoryや探索条件は変わりません。

## Xcodeでビルドする

1. ScrubのXcodeプロジェクトを開きます。
2. Signing & Capabilitiesで自分のTeamと一意のBundle Identifierを設定します。
3. iPadを接続し、実行先に選択します。
4. Debug構成でビルドしてiPadへインストールします。
5. 初回接続時にBluetooth利用許可が表示されたら承認します。

## 接続を確認する

1. Scrubから`https://xcratch.github.io/editor/`を開きます。
2. 最新の`irobotRoot.mjs`を読み込みます。
3. Rootの電源を入れ、「Rootに接続する」を押します。
4. 初回のBluetooth許可を承認し、そのままデバイス一覧が更新されるまで待ちます。
5. 複数台ある場合は名前を確認して選択します。
6. LED、音、マーカーなど、移動を伴わない命令から確認します。

Root拡張は、Root専用名からScrubの`ScratchLinkKit.Socket`を取得します。許可処理中に最初の探索要求へ応答がない場合は、Socket IDを変えずにネイティブセッションの開始要求と探索を再試行します。このため、CoreBluetoothの早期初期化は追加しません。

## よくある問題

### `patch does not apply`

Scrub側の対象ファイルがパッチ作成時と異なるか、既に同じ修正が適用されています。`git status`とサブモジュールのコミットを確認してください。以前の`inject.js`公開条件変更パッチやBluetooth早期初期化パッチは重ねて適用しません。

### パッチファイルが見つからない

`git -C work/Scrub apply relative/path.patch`では、相対パスがScrub側から解釈されます。この手順のように`cd Scrub`してから指定するか、パッチの絶対パスを使用してください。

### Rootが一覧に出ない

- Rootが別の端末やアプリへ接続されていないか確認します。
- RootとiPadを近づけます。
- ScrubのBluetooth許可を確認します。
- 初回許可後は最大30秒待つか、デバイス一覧を更新します。

### 接続できるが命令が動かない

最新版の`irobotRoot.mjs`を読み込んでいるか確認し、URLへ異なるクエリ文字列を付けてキャッシュを更新します。

```text
https://naominix.github.io/xcx-irobot-root/irobotRoot.mjs?v=scrub-original-bridge
```
