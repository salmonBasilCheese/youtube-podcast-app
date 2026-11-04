# YT Podcast

YouTube内のPodcastを音声のみ・画面オフで聞く、個人用iPhoneアプリ(Expo / React Native)。

## ビルドと導入(Mac不要・無料)
1. GitHub Actions の「Build unsigned iOS ipa」を手動実行 → 成果物 `app-unsigned-ipa` をダウンロード
2. PCにApple Devices(Microsoft Store)とSideloadlyを入れ、iPhoneをUSB接続
3. Sideloadlyで `app-unsigned.ipa` を無料Apple IDで署名してiPhoneへ導入
4. iPhone: 設定 > 一般 > VPNとデバイス管理 でApple IDを信頼
5. **7日ごとに** 手順3をやり直す(無料Apple IDの制限。同時に入れられる自作アプリは3本まで)

## 使い方
1. 初回のみ、ホーム画面にYouTube Data API v3のキーを入力(端末内にだけ保存。リポジトリには含めない)
2. 「Podcast一覧を開く」→ 再生リスト → エピソードを選ぶ(選んだ回から後ろが順に再生される)
3. 再生が始まらないときは、プレーヤーのサムネイルを一度タップ
4. 画面オフで止まったら、ロック画面の再生ボタンを押す(その後は画面オフのまま連続再生される)
5. 次回は、ホームの「続きから再生」で、最後に聞いた動画の位置から再開できる

## 既知の制限
- 画面オフ直後に一度止まる(iOSの仕様。アプリ側の自動再開は効果がなかった)
- 次へ/前へボタンは未実装(エピソード一覧から選び直す)
- 再生リストは最大100本まで連続再生

## 開発メモ
- 構成: `App.tsx`(画面遷移・一覧) / `src/PlayerScreen.tsx`(再生) / `src/api.ts`(YouTube Data API) / `src/storage.ts`(設定・再生位置)
- ライブラリ `react-native-youtube-iframe` は倍速変更の命令を受ける処理が欠けているため、`PlayerScreen.tsx` の注入スクリプトで補っている
