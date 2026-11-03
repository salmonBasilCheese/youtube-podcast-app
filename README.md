# YT Podcast

YouTube内のPodcastを音声のみ・画面オフで聞く、個人用iPhoneアプリ(Expo / React Native)。

## ビルドと導入(Mac不要・無料)
1. GitHub Actions の「Build unsigned iOS ipa」を手動実行 → 成果物 `app-unsigned-ipa` をダウンロード
2. PCにApple Devices(Microsoft Store)とSideloadlyを入れ、iPhoneをUSB接続
3. Sideloadlyで `app-unsigned.ipa` を無料Apple IDで署名してiPhoneへ導入
4. iPhone: 設定 > 一般 > VPNとデバイス管理 でApple IDを信頼
5. **7日ごとに** 手順3をやり直す(無料Apple IDの制限。同時に入れられる自作アプリは3本まで)

## 開発メモ
- 現在はPhase 0(画面オフ再生の検証)。`App.tsx` が検証画面
- 確認項目: 再生 → 画面オフ → 5分以上放置しても音が続くか / ロック画面に操作が出るか
