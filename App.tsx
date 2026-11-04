// Phase 0: 画面オフでも音声が継続するかを実機で確認するための検証用画面
import { useEffect, useRef, useState } from 'react';
import { AppState, Button, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import YoutubeIframe from 'react-native-youtube-iframe';

// 画面オフ時にページが「非表示」になりYouTubeが自動停止するのを防ぐため、
// 常に「表示中・フォーカスあり」と見せかける(全フレームに読み込み前に注入)
const KEEP_VISIBLE_JS = `
(function () {
  try {
    Object.defineProperty(document, 'hidden', { get: function () { return false; }, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: function () { return 'visible'; }, configurable: true });
    Object.defineProperty(document, 'webkitHidden', { get: function () { return false; }, configurable: true });
    document.hasFocus = function () { return true; };
    ['visibilitychange', 'webkitvisibilitychange', 'pagehide', 'blur'].forEach(function (t) {
      window.addEventListener(t, function (e) { e.stopImmediatePropagation(); }, true);
      document.addEventListener(t, function (e) { e.stopImmediatePropagation(); }, true);
    });
  } catch (e) {}
})();
true;
`;

type Source = { videoId?: string; listId?: string };

// YouTubeのURLから動画ID・プレイリストIDを取り出す(11文字の動画IDだけの入力も可)
function parseSource(input: string): Source {
  const s = input.trim();
  const list = s.match(/[?&]list=([\w-]+)/)?.[1];
  const video = s.match(/(?:[?&]v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/)?.[1];
  if (list) return { listId: list, videoId: video };
  if (video) return { videoId: video };
  if (/^[\w-]{11}$/.test(s)) return { videoId: s };
  if (/^(PL|UU|OL|FL|RD)[\w-]+$/.test(s)) return { listId: s };
  return {};
}

export default function App() {
  const [input, setInput] = useState('');
  const [source, setSource] = useState<Source>({});
  const [loadCount, setLoadCount] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const addLog = (s: string) =>
    setLog((l) => [`${new Date().toLocaleTimeString()} ${s}`, ...l].slice(0, 14));

  // 無音をループ再生してアプリを「音声再生中」に保つ(バックグラウンドで止まりにくくする)
  const keepAlive = useAudioPlayer(require('./assets/silence.wav'));

  useEffect(() => {
    keepAlive.loop = true;
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    })
      .then(() => addLog('audio mode set'))
      .catch((e) => addLog(`audio mode error: ${e}`));
  }, []);

  // 画面オフ(バックグラウンド移行)の直後に起きた一時停止だけ、自動で再開する。
  // ロック画面などでユーザーが止めた場合(移行から時間が経っている)は再開しない。
  const wantPlay = useRef(false); // ユーザーが「再生したい」状態か
  const bgAt = useRef(0); // 最後にバックグラウンドへ移った時刻
  const resumeAt = useRef(0); // 自動再開の操作をした時刻(自分の操作による停止を無視する)
  const resumeTries = useRef(0);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') bgAt.current = Date.now();
      else resumeTries.current = 0;
      addLog(`app: ${st}`);
    });
    return () => sub.remove();
  }, []);

  const tryAutoResume = () => {
    const now = Date.now();
    if (!wantPlay.current) return;
    if (now - bgAt.current > 3000) return; // 移行直後の停止ではない
    if (now - resumeAt.current < 1500) return; // 自分の再開操作による停止
    if (resumeTries.current >= 3) return;
    resumeTries.current += 1;
    resumeAt.current = now;
    addLog(`自動再開 ${resumeTries.current}回目`);
    setPlaying(false);
    setTimeout(() => setPlaying(true), 400);
  };

  const togglePlay = () => {
    wantPlay.current = !playing;
    setPlaying(!playing);
  };

  const load = () => {
    wantPlay.current = true;
    const src = parseSource(input);
    if (!src.videoId && !src.listId) {
      addLog('URLを認識できません');
      return;
    }
    addLog(`読込 video=${src.videoId ?? '-'} list=${src.listId ?? '-'}`);
    setSource(src);
    setLoadCount((c) => c + 1); // 読み込みのたびにプレーヤーを作り直す
    setPlaying(true);
    keepAlive.play();
    addLog('無音キープアライブ開始');
  };

  const hasSource = !!(source.videoId || source.listId);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Phase 0: 画面オフ再生テスト</Text>

      <View style={styles.inputWrap}>
        <TextInput
          style={styles.input}
          placeholder="YouTubeの動画/プレイリストURL"
          placeholderTextColor="#888"
          value={input}
          onChangeText={setInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {input !== '' && (
          <Pressable style={styles.clear} onPress={() => setInput('')} hitSlop={10}>
            <Text style={styles.clearText}>×</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.row}>
        <Button title="読み込む" onPress={load} />
        {hasSource && (
          <Button title={playing ? '一時停止' : '再生'} onPress={togglePlay} />
        )}
      </View>

      {/* 診断中: プレーヤーを表示している(原因特定後に透明化する) */}
      <View style={styles.hidden}>
        {hasSource && (
          <YoutubeIframe
            key={loadCount}
            height={200}
            width={200}
            videoId={source.listId ? undefined : source.videoId}
            playList={source.listId}
            play={playing}
            onReady={() => addLog('player ready')}
            onChangeState={(s: string) => {
              addLog(`state: ${s}`);
              if (s === 'ended' && !source.listId) {
                wantPlay.current = false;
                setPlaying(false);
              }
              if (s === 'paused') tryAutoResume();
            }}
            onError={(e: string) => addLog(`error: ${e}`)}
            webViewProps={{
              allowsInlineMediaPlayback: true,
              mediaPlaybackRequiresUserAction: false,
              injectedJavaScriptBeforeContentLoaded: KEEP_VISIBLE_JS,
              injectedJavaScriptBeforeContentLoadedForMainFrameOnly: false,
            }}
          />
        )}
      </View>

      <Text style={styles.sub}>ログ(新しい順)</Text>
      {log.map((l, i) => (
        <Text key={i} style={styles.log}>{l}</Text>
      ))}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111', padding: 16, gap: 8 },
  title: { color: '#fff', fontSize: 18, marginTop: 24 },
  inputWrap: { justifyContent: 'center' },
  input: { backgroundColor: '#222', color: '#fff', padding: 10, paddingRight: 40, borderRadius: 6 },
  clear: {
    position: 'absolute',
    right: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#555',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearText: { color: '#fff', fontSize: 18, lineHeight: 20 },
  row: { flexDirection: 'row', justifyContent: 'center', gap: 16 },
  hidden: { width: 200, height: 200, alignSelf: 'center' },
  sub: { color: '#aaa', marginTop: 12 },
  log: { color: '#ccc', fontSize: 12 },
});
