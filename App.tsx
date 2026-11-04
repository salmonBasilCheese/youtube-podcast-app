// Phase 0: 画面オフでも音声が継続するかを実機で確認するための検証用画面
import { useEffect, useState } from 'react';
import { Button, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { setAudioModeAsync } from 'expo-audio';
import YoutubeIframe from 'react-native-youtube-iframe';

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

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    })
      .then(() => addLog('audio mode set'))
      .catch((e) => addLog(`audio mode error: ${e}`));
  }, []);

  const load = () => {
    const src = parseSource(input);
    if (!src.videoId && !src.listId) {
      addLog('URLを認識できません');
      return;
    }
    addLog(`読込 video=${src.videoId ?? '-'} list=${src.listId ?? '-'}`);
    setSource(src);
    setLoadCount((c) => c + 1); // 読み込みのたびにプレーヤーを作り直す
    setPlaying(true);
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
        {!hasSource ? (
          <Button title="読み込んで再生" onPress={load} />
        ) : (
          <>
            <Button title={playing ? '一時停止' : '再生'} onPress={() => setPlaying((p) => !p)} />
            <Button title="別のURLを読み込む" onPress={load} />
          </>
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
              if (s === 'ended' && !source.listId) setPlaying(false);
            }}
            onError={(e: string) => addLog(`error: ${e}`)}
            webViewProps={{ allowsInlineMediaPlayback: true, mediaPlaybackRequiresUserAction: false }}
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
