# XcratchとApp Store版Scrubの統合案

## 結論

Root拡張をiPadOSで利用するためにScrubを変更する必要はありません。Webエディター側がScrubの標準Scratch Link公開条件を満たす必要があります。

## Xcratch側の最小変更

初期HTMLへ次のマーカーを追加します。

```html
<script id="scratch-link-extension-script"></script>
```

Scrubの`inject.js`はdocument endでこの要素を検出し、既存の処理によって次のSocketを公開します。

```js
self.Scratch.ScratchLinkSafariSocket = ScratchLinkKit.Socket;
```

XcratchのScratch VMはこの標準プロパティを既に参照します。Scrub以外のブラウザーではSocketが注入されないため、従来どおりWeb BluetoothまたはPC版Scratch Linkへフォールバックします。

## GitHub Pagesで検証版をホストする案

公式Xcratchへの変更が反映される前に検証する場合は、Xcratchをフォークして次の手順で公開できます。

1. Xcratchの初期HTMLへマーカーを追加します。
2. Xcratchの既存テストとproduction buildを実行します。
3. GitHub Pagesへテスト用エディターを配置します。
4. App Store版ScrubのCustom Home URLへ配置先を設定します。
5. Root単独、micro:bit More単独、同時接続を検証します。

独自ホスト版では、公式Xcratchとの差分、更新追従、利用者がアクセスするドメインを明記する必要があります。

## 検証項目

- Root単独接続
- micro:bit More v2単独接続
- Rootとmicro:bit More v2の同時接続
- 両方の接続順序を入れ替える
- 一方を切断した後も他方が動作する
- 切断したデバイスを再接続する
- micro:bitのイベントからRootへ命令する
- Rootのセンサーイベントからmicro:bitへ命令する

## 確認済み事項

2026年7月26日、App Store版Scrubとmicro:bit More専用エディターを使用し、Rootとmicro:bit More v2の共存および拡張間連携を確認しました。この結果から、ScrubのBLEセッション実装とRoot拡張は複数デバイス環境で共存可能です。
