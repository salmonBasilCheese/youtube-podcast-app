// Phase 0: 画面オフでも音声が継続するかを実機で確認するための検証用画面
import { useEffect, useState } from 'react';
import { Button, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { setAudioModeAsync } from 'expo-audio';
import YoutubeIframe from 'react-native-youtube-iframe';

// YouTubeのURLまたは11文字の動画IDから動画IDを取り出す
function extractVideoId(input: string): string {
  const m = input.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/);
  return m ? m[1] : input.trim();
}

export default function App() {
  const [input, setInput] = useState('');
  const [videoId, setVideoId] = useState('');
  const [playing, setPlaying] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const addLog = (s: string) =>
    setLog((l) => [`${new Date().toLocaleTimeString()} ${s}`, ...l].slice(0, 12));

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    })
      .then(() => addLog('audio mode set'))
      .catch((e) => addLog(`audio mode error: ${e}`));
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Phase 0: 画面オフ再生テスト</Text>
      <TextInput
        style={styles.input}
        placeholder="YouTubeのURLか動画ID"
        placeholderTextColor="#888"
        value={input}
        onChangeText={setInput}
        autoCapitalize="none"
      />
      <Button
        title="読み込み"
        onPress={() => {
          setVideoId(extractVideoId(input));
          setPlaying(false);
        }}
      />
      <View style={styles.row}>
        <Button title={playing ? '一時停止' : '再生'} onPress={() => setPlaying((p) => !p)} />
      </View>

      {/* 映像は非表示(高さ1px)。音声だけを使う */}
      <View style={styles.hidden}>
        {videoId !== '' && (
          <YoutubeIframe
            height={1}
            width={1}
            videoId={videoId}
            play={playing}
            onChangeState={(s: string) => {
              addLog(`state: ${s}`);
              if (s === 'ended') setPlaying(false);
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
  input: { backgroundColor: '#222', color: '#fff', padding: 10, borderRadius: 6 },
  row: { flexDirection: 'row', justifyContent: 'center' },
  hidden: { height: 1, width: 1, opacity: 0.01, overflow: 'hidden' },
  sub: { color: '#aaa', marginTop: 12 },
  log: { color: '#ccc', fontSize: 12 },
});
