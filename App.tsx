// YT Podcast: ホーム(設定・URL再生) → 再生リスト(Podcast)一覧 → エピソード一覧 → プレーヤー
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  findChannelId,
  getPlaylistTitle,
  listEpisodes,
  listLatestVideos,
  listPlaylists,
  normalizeHandle,
  Episode,
  Playlist,
} from './src/api';
import PlayerScreen from './src/PlayerScreen';
import {
  addRecent,
  DEFAULT_SETTINGS,
  LastSession,
  loadDiagLogs,
  loadLast,
  loadPositions,
  loadRecents,
  loadSettings,
  Recent,
  saveSettings,
  Settings,
} from './src/storage';

type Screen =
  | { name: 'home' }
  | { name: 'playlists'; items: Playlist[] }
  | { name: 'episodes'; title: string; items: Episode[]; back: Screen }
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

  // ホームに戻るたびに「続きから再生」用の記録を読み直す
  const [last, setLast] = useState<LastSession | null>(null);
  const [recents, setRecents] = useState<Recent[]>([]);
  const [logs, setLogs] = useState<string[] | null>(null); // nullなら診断ログは閉じている
  useEffect(() => {
    if (screen.name === 'home') {
      loadLast().then(setLast);
      loadRecents().then(setRecents);
    }
  }, [screen.name]);

  const toggleLogs = () => {
    if (logs) setLogs(null);
    else loadDiagLogs().then(setLogs);
  };

  const resumeLast = () => {
    if (!last) return;
    const idx = Math.max(0, last.queue.findIndex((e) => e.id === last.currentId));
    setScreen({ name: 'player', queue: last.queue, startIndex: idx, back: { name: 'home' } });
  };

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

  // チャンネルの再生リスト一覧(成功したらチャンネルを履歴に残す)
  const loadChannel = () =>
    run(async () => {
      const key = needKey();
      const channelId = await findChannelId(settings.handle, key);
      const items = await listPlaylists(channelId, key);
      if (items.length === 0) throw new Error('再生リストが見つかりません');
      setRecents(await addRecent({ kind: 'channel', handle: normalizeHandle(settings.handle) }));
      setScreen({ name: 'playlists', items });
    });

  // チャンネルの最新動画50件(ショート除外)
  const loadLatest = () =>
    run(async () => {
      const key = needKey();
      const channelId = await findChannelId(settings.handle, key);
      const items = await listLatestVideos(channelId, key, 50);
      setRecents(await addRecent({ kind: 'channel', handle: normalizeHandle(settings.handle) }));
      setScreen({ name: 'episodes', title: '最新動画', items, back: { name: 'home' } });
    });

  const openPlaylist = (p: Playlist, playlists: Playlist[]) =>
    run(async () => {
      const items = await listEpisodes(p.id, needKey());
      setScreen({
        name: 'episodes',
        title: p.title,
        items,
        back: { name: 'playlists', items: playlists },
      });
    });

  // 再生リストIDから直接エピソード一覧を開く(URL入力・履歴から)
  const fetchPlaylist = async (id: string, knownTitle?: string) => {
    const key = needKey();
    const [title, items] = await Promise.all([
      knownTitle ? Promise.resolve(knownTitle) : getPlaylistTitle(id, key),
      listEpisodes(id, key),
    ]);
    setRecents(await addRecent({ kind: 'playlist', id, title }));
    setScreen({ name: 'episodes', title, items, back: { name: 'home' } });
  };

  const pickRecent = (r: Recent) => {
    if (r.kind === 'channel') update({ handle: r.handle });
    else run(() => fetchPlaylist(r.id, r.title));
  };

  const playUrl = () =>
    run(async () => {
      const { listId, videoId } = parseUrl(url);
      if (listId) {
        await fetchPlaylist(listId);
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
        <Pressable onPress={() => setScreen(here.back)} hitSlop={10}>
          <Text style={s.back}>← 戻る</Text>
        </Pressable>
        <Text style={s.title} numberOfLines={2}>{here.title}</Text>
        <EpisodeList
          items={here.items}
          onPick={(index) =>
            setScreen({ name: 'player', queue: here.items, startIndex: index, back: here })
          }
        />
      </SafeAreaView>
    );
  }

  // ホーム
  return (
    <SafeAreaView style={s.container}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
      <Text style={s.title}>YT Podcast</Text>

      {last && (
        <Pressable style={s.resume} onPress={resumeLast}>
          <Text style={s.resumeLabel}>続きから再生</Text>
          <Text style={s.resumeTitle} numberOfLines={1}>
            {last.queue.find((e) => e.id === last.currentId)?.title ?? ''}
          </Text>
        </Pressable>
      )}

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
      <View style={s.btnRow}>
        <Pressable style={[s.primary, s.flex1]} onPress={loadChannel}>
          <Text style={s.primaryText}>再生リスト一覧</Text>
        </Pressable>
        <Pressable style={[s.primary, s.flex1]} onPress={loadLatest}>
          <Text style={s.primaryText}>最新動画50件</Text>
        </Pressable>
      </View>

      {recents.length > 0 && (
        <>
          <Text style={s.label}>最近開いたもの(タップで選択)</Text>
          {recents.map((r, i) => (
            <Pressable key={i} style={s.recent} onPress={() => pickRecent(r)}>
              <Text style={s.recentKind}>{r.kind === 'channel' ? 'チャンネル' : '再生リスト'}</Text>
              <Text style={s.recentText} numberOfLines={1}>
                {r.kind === 'channel' ? r.handle : r.title}
              </Text>
            </Pressable>
          ))}
        </>
      )}

      <Text style={[s.label, { marginTop: 16 }]}>URLを開く(再生リスト → 一覧 / 動画 → 再生)</Text>
      <Field value={url} onChangeText={setUrl} placeholder="https://www.youtube.com/..." />
      <Pressable style={s.primary} onPress={playUrl}>
        <Text style={s.primaryText}>開く</Text>
      </Pressable>

      {busy && <ActivityIndicator color="#fff" style={{ marginTop: 12 }} />}
      {error !== '' && <Text style={s.error}>{error}</Text>}

      <Pressable onPress={toggleLogs} hitSlop={10}>
        <Text style={[s.label, { marginTop: 24 }]}>{logs ? '▼ 診断ログを閉じる' : '▶ 診断ログ'}</Text>
      </Pressable>
      {logs && (logs.length === 0
        ? <Text style={s.log}>ログはありません</Text>
        : logs.map((l, i) => <Text key={i} style={s.log}>{l}</Text>))}
      </ScrollView>
    </SafeAreaView>
  );
}

// エピソード一覧(タイトルのみ・1行で省略表示)。途中まで聞いた回は位置を表示する
function EpisodeList({ items, onPick }: { items: Episode[]; onPick: (index: number) => void }) {
  const [pos, setPos] = useState<Record<string, number>>({});
  useEffect(() => {
    loadPositions(items.map((e) => e.id)).then(setPos);
  }, [items]);

  const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

  return (
    <FlatList
      data={items}
      keyExtractor={(e) => e.id}
      renderItem={({ item, index }) => (
        <Pressable style={s.row} onPress={() => onPick(index)}>
          <Text style={s.rowTitle} numberOfLines={1} ellipsizeMode="tail">{item.title}</Text>
          {pos[item.id] > 5 && <Text style={s.rowSub}>途中: {fmt(pos[item.id])} まで</Text>}
        </Pressable>
      )}
    />
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
  resume: { backgroundColor: '#1f3a1f', padding: 14, borderRadius: 10, marginTop: 8 },
  resumeLabel: { color: '#8f8', fontSize: 13 },
  resumeTitle: { color: '#fff', fontSize: 16, marginTop: 4 },
  btnRow: { flexDirection: 'row', gap: 8 },
  flex1: { flex: 1 },
  recent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#1a1a1a',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  recentKind: { color: '#6cf', fontSize: 11 },
  recentText: { color: '#fff', fontSize: 14, flex: 1 },
  log: { color: '#777', fontSize: 11 },
});
