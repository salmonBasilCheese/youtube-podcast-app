// YT Podcast: ホーム(設定・URL再生) → 再生リスト(Podcast)一覧 → エピソード一覧 → プレーヤー
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { findChannelId, listEpisodes, listPlaylists, Episode, Playlist } from './src/api';
import PlayerScreen from './src/PlayerScreen';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, Settings } from './src/storage';

type Screen =
  | { name: 'home' }
  | { name: 'playlists'; items: Playlist[] }
  | { name: 'episodes'; playlist: Playlist; items: Episode[]; playlists: Playlist[] }
  | { name: 'player'; queue: Episode[]; startIndex: number; back: Screen };

// YouTubeのURLから動画ID・再生リストIDを取り出す
function parseUrl(input: string): { videoId?: string; listId?: string } {
  const s = input.trim();
  const listId = s.match(/[?&]list=([\w-]+)/)?.[1];
  const videoId =
    s.match(/(?:[?&]v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/)?.[1] ??
    (/^[\w-]{11}$/.test(s) ? s : undefined);
  return { listId, videoId };
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setReady(true);
    });
  }, []);

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  };

  // 通信を伴う処理の共通ラッパー(ローディング表示とエラー表示)
  const run = async (fn: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const needKey = () => {
    if (!settings.apiKey.trim()) throw new Error('先にAPIキーを入力してください');
    return settings.apiKey.trim();
  };

  const loadChannel = () =>
    run(async () => {
      const key = needKey();
      const channelId = await findChannelId(settings.handle, key);
      const items = await listPlaylists(channelId, key);
      if (items.length === 0) throw new Error('再生リストが見つかりません');
      setScreen({ name: 'playlists', items });
    });

  const openPlaylist = (p: Playlist, playlists: Playlist[]) =>
    run(async () => {
      const items = await listEpisodes(p.id, needKey());
      setScreen({ name: 'episodes', playlist: p, items, playlists });
    });

  const playUrl = () =>
    run(async () => {
      const { listId, videoId } = parseUrl(url);
      if (listId) {
        const items = await listEpisodes(listId, needKey());
        const idx = Math.max(0, items.findIndex((e) => e.id === videoId));
        setScreen({ name: 'player', queue: items, startIndex: idx, back: { name: 'home' } });
      } else if (videoId) {
        setScreen({
          name: 'player',
          queue: [{ id: videoId, title: '動画' }],
          startIndex: 0,
          back: { name: 'home' },
        });
      } else {
        throw new Error('URLを認識できません');
      }
    });

  if (!ready) return <View style={s.container} />;

  if (screen.name === 'player') {
    return (
      <PlayerScreen
        queue={screen.queue}
        startIndex={screen.startIndex}
        rate={settings.rate}
        onRateChange={(rate) => update({ rate })}
        onBack={() => setScreen(screen.back)}
      />
    );
  }

  if (screen.name === 'playlists') {
    const here = screen;
    return (
      <SafeAreaView style={s.container}>
        <Pressable onPress={() => setScreen({ name: 'home' })} hitSlop={10}>
          <Text style={s.back}>← 戻る</Text>
        </Pressable>
        <Text style={s.title}>Podcast / 再生リスト</Text>
        {busy && <ActivityIndicator color="#fff" />}
        {error !== '' && <Text style={s.error}>{error}</Text>}
        <FlatList
          data={here.items}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <Pressable style={s.row} onPress={() => openPlaylist(item, here.items)}>
              <Text style={s.rowTitle}>{item.title}</Text>
              <Text style={s.rowSub}>{item.count}本</Text>
            </Pressable>
          )}
        />
      </SafeAreaView>
    );
  }

  if (screen.name === 'episodes') {
    const here = screen;
    return (
      <SafeAreaView style={s.container}>
        <Pressable
          onPress={() => setScreen({ name: 'playlists', items: here.playlists })}
          hitSlop={10}
        >
          <Text style={s.back}>← 戻る</Text>
        </Pressable>
        <Text style={s.title} numberOfLines={2}>{here.playlist.title}</Text>
        <FlatList
          data={here.items}
          keyExtractor={(e) => e.id}
          renderItem={({ item, index }) => (
            <Pressable
              style={s.row}
              onPress={() =>
                setScreen({ name: 'player', queue: here.items, startIndex: index, back: here })
              }
            >
              <Text style={s.rowTitle} numberOfLines={2}>{item.title}</Text>
            </Pressable>
          )}
        />
      </SafeAreaView>
    );
  }

  // ホーム
  return (
    <SafeAreaView style={s.container}>
      <Text style={s.title}>YT Podcast</Text>

      <Text style={s.label}>YouTube Data API キー(この端末にだけ保存)</Text>
      <Field
        value={settings.apiKey}
        onChangeText={(apiKey) => update({ apiKey })}
        placeholder="AIza..."
        secure
      />

      <Text style={s.label}>チャンネルのハンドル</Text>
      <Field
        value={settings.handle}
        onChangeText={(handle) => update({ handle })}
        placeholder="@チャンネル名"
      />
      <Pressable style={s.primary} onPress={loadChannel}>
        <Text style={s.primaryText}>Podcast一覧を開く</Text>
      </Pressable>

      <Text style={[s.label, { marginTop: 16 }]}>URLを直接再生(動画 / 再生リスト)</Text>
      <Field value={url} onChangeText={setUrl} placeholder="https://www.youtube.com/..." />
      <Pressable style={s.primary} onPress={playUrl}>
        <Text style={s.primaryText}>再生画面へ</Text>
      </Pressable>

      {busy && <ActivityIndicator color="#fff" style={{ marginTop: 12 }} />}
      {error !== '' && <Text style={s.error}>{error}</Text>}
    </SafeAreaView>
  );
}

// ワンタップで消せる「×」付きの入力欄
function Field(props: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  secure?: boolean;
}) {
  return (
    <View style={s.inputWrap}>
      <TextInput
        style={s.input}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor="#777"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={props.secure}
      />
      {props.value !== '' && (
        <Pressable style={s.clear} onPress={() => props.onChangeText('')} hitSlop={10}>
          <Text style={s.clearText}>×</Text>
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111', padding: 16, gap: 8 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', marginTop: 8 },
  back: { color: '#6cf', fontSize: 16, marginTop: 24 },
  label: { color: '#aaa', fontSize: 13, marginTop: 8 },
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
  primary: { backgroundColor: '#1d5fd8', padding: 12, borderRadius: 8, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 16 },
  row: { paddingVertical: 12, borderBottomColor: '#2a2a2a', borderBottomWidth: 1 },
  rowTitle: { color: '#fff', fontSize: 15 },
  rowSub: { color: '#888', fontSize: 12, marginTop: 2 },
  error: { color: '#f66', marginTop: 8 },
});
