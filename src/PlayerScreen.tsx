// プレーヤー画面: 再生/一時停止・±15秒・倍速・スリープタイマー・再生位置の記憶
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import YoutubeIframe, { YoutubeIframeRef } from 'react-native-youtube-iframe';
import type { Episode } from './api';
import { appendDiagLog, clearPosition, loadPosition, saveLast, savePosition } from './storage';

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
  // ライブラリは倍速変更の命令を送るが、ページ側に受け取る処理がないため、ここで補う(最上位ページのみ)
  try {
    if (window.top === window) {
      window.addEventListener('message', function (event) {
        try {
          var d = JSON.parse(event.data);
          if (d.eventName === 'setPlaybackRate' && window.player && d.meta) {
            window.player.setPlaybackRate(d.meta.playbackRate);
          }
        } catch (e) {}
      });
    }
  } catch (e) {}
})();
true;
`;

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SLEEP_OPTIONS = [0, 15, 30, 60]; // 分。0はオフ
const MAX_QUEUE = 100;

type Props = {
  queue: Episode[];
  startIndex: number;
  rate: number;
  onRateChange: (r: number) => void;
  onBack: () => void;
};

const videoIdFromUrl = (url: string) => url.match(/[?&]v=([\w-]{11})/)?.[1];

// 応答しないプレーヤーを待ち続けないための時間切れ付き待機
const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });

// 他アプリの音を止めず・自分も止められにくい設定(通知などで音量が下がったままになるのを避ける)
const applyAudioMode = () =>
  setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'mixWithOthers',
  });

const AUTO_RESUME_WINDOW_MS = 3000; // 画面オフなどでアプリを離れてから、この間の停止だけ自動で再開する
const MAX_AUTO_RESUMES = 3;
const PLAY_RESPONSE_MS = 5000; // 再生ボタンを押してから反応を待つ時間

export default function PlayerScreen({ queue, startIndex, rate, onRateChange, onBack }: Props) {
  const { width: screenW } = useWindowDimensions();
  const playerW = screenW - 32; // 左右の余白16pxずつ
  const playerH = Math.round((playerW * 9) / 16);
  const [baseIndex, setBaseIndex] = useState(startIndex); // 作り直し時は聞いている回から組み直す
  const [webKey, setWebKey] = useState(0); // 変えるとWebView(プレーヤー)が作り直される
  const ids = queue.slice(baseIndex, baseIndex + MAX_QUEUE).map((e) => e.id);
  const titleOf = (id?: string) => queue.find((e) => e.id === id)?.title ?? '';

  const playerRef = useRef<YoutubeIframeRef>(null);
  const [playing, setPlaying] = useState(true);
  const [currentId, setCurrentId] = useState(ids[0]);
  const [sleepMin, setSleepMin] = useState(0);
  const [sleepLeft, setSleepLeft] = useState(0); // 残り秒
  const [log, setLog] = useState<string[]>([]);
  const resumedFor = useRef<string | null>(null);

  // persist=true なら端末にも残す(ホームの診断ログで後から見られる)
  const addLog = (s: string, persist = false) => {
    setLog((l) => [`${new Date().toLocaleTimeString()} ${s}`, ...l].slice(0, 8));
    if (persist) appendDiagLog(s);
  };

  // 無音をループ再生してアプリを「音声再生中」に保つ(バックグラウンドで止まりにくくする)
  const keepAlive = useAudioPlayer(require('../assets/silence.wav'));
  const keepAliveRef = useRef(keepAlive);
  keepAliveRef.current = keepAlive;
  useEffect(() => {
    keepAlive.loop = true;
    keepAlive.play();
    applyAudioMode().catch((e) => addLog(`audio mode error: ${e}`, true));
    return () => keepAlive.pause();
  }, []);

  // --- 再生の安定化 ---
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;
  const wantPlay = useRef(true); // 本人が再生を望んでいるか
  const lastState = useRef('unstarted'); // プレーヤーが最後に報告した状態
  const readyRef = useRef(false); // プレーヤーの読み込みが終わったか
  const leftAt = useRef(0); // アプリが前面から離れた時刻
  const autoResumes = useRef(0);
  const recovering = useRef(false);
  const isPlayingState = () => lastState.current === 'playing' || lastState.current === 'buffering';

  // プレーヤーを作り直し、音声セッションも張り直す(放置後に再生できなくなったときの復旧)
  const recover = async (reason: string) => {
    if (recovering.current) return;
    recovering.current = true;
    addLog(`復旧: ${reason}`, true);
    try {
      await applyAudioMode();
    } catch (e) {
      addLog(`復旧中のaudio mode error: ${e}`, true);
    }
    try {
      keepAliveRef.current.play();
    } catch {}
    const idx = queue.findIndex((e) => e.id === currentIdRef.current);
    if (idx >= 0) setBaseIndex(idx);
    readyRef.current = false;
    lastState.current = 'unstarted';
    resumedFor.current = null; // 作り直したあとも保存位置から再開する
    wantPlay.current = true;
    setPlaying(true);
    setWebKey((k) => k + 1);
    setTimeout(() => { recovering.current = false; }, 3000);
  };
  const recoverRef = useRef(recover);
  recoverRef.current = recover;

  // プレーヤーが応答するか確認する(応答なしならWebViewが止まっている)
  const probe = async () => {
    try {
      await withTimeout(playerRef.current!.getCurrentTime(), 3000);
      return true;
    } catch {
      return false;
    }
  };

  // 前面/背面の切り替えを監視する
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (st) => {
      if (st !== 'active') {
        leftAt.current = Date.now();
        return;
      }
      if (!keepAliveRef.current.playing) {
        keepAliveRef.current.play();
        addLog('前面復帰: 無音ループを再開', true);
      }
      if (!readyRef.current) return;
      if (!(await probe())) {
        recoverRef.current('前面復帰時にプレーヤーが応答なし');
        return;
      }
      // 音量低下の切り分け用に、プレーヤー側の音量・ミュート状態を記録する
      try {
        const [vol, muted] = await Promise.all([
          withTimeout(playerRef.current!.getVolume(), 2000),
          withTimeout(playerRef.current!.isMuted(), 2000),
        ]);
        addLog(`前面復帰: 状態=${lastState.current} 音量=${vol} ミュート=${muted}`, true);
      } catch {}
    });
    return () => sub.remove();
  }, []);

  // 再生ボタン: 見かけ上は再生中でも実際は止まっているときは、押し直しで再生をやり直す
  const togglePlay = () => {
    if (playing && isPlayingState()) {
      wantPlay.current = false;
      setPlaying(false);
      return;
    }
    wantPlay.current = true;
    if (playing) {
      setPlaying(false);
      setTimeout(() => setPlaying(true), 100);
    } else {
      setPlaying(true);
    }
    setTimeout(() => {
      if (wantPlay.current && !isPlayingState() && readyRef.current) {
        recoverRef.current('再生ボタンを押しても再生が始まらない');
      }
    }, PLAY_RESPONSE_MS);
  };

  // 今どの動画を聞いているかを保存(次回「続きから再生」で使う)
  useEffect(() => {
    if (currentId) saveLast({ queue, currentId });
  }, [currentId]);

  // 5秒ごとに再生位置を保存し、再生中の動画IDを追従する
  useEffect(() => {
    const t = setInterval(async () => {
      // 割り込み(通知・通話など)で止まった無音ループを再開する
      try {
        if (!keepAliveRef.current.playing) {
          keepAliveRef.current.play();
          addLog('無音ループが止まっていたため再開', true);
        }
      } catch {}
      try {
        const url = await playerRef.current?.getVideoUrl();
        const id = url ? videoIdFromUrl(url) : undefined;
        if (!id) return;
        setCurrentId(id);
        const [pos, dur] = await Promise.all([
          playerRef.current!.getCurrentTime(),
          playerRef.current!.getDuration(),
        ]);
        if (dur > 0 && dur - pos < 15) await clearPosition(id); // ほぼ最後まで聞いた
        else if (pos > 5) await savePosition(id, pos);
      } catch {}
    }, 5000);
    return () => clearInterval(t);
  }, []);

  // スリープタイマー
  useEffect(() => {
    if (sleepMin === 0) {
      setSleepLeft(0);
      return;
    }
    const endAt = Date.now() + sleepMin * 60_000;
    const t = setInterval(() => {
      const left = Math.max(0, Math.round((endAt - Date.now()) / 1000));
      setSleepLeft(left);
      if (left === 0) {
        wantPlay.current = false;
        setPlaying(false);
        setSleepMin(0);
        addLog('スリープタイマーで停止');
      }
    }, 1000);
    return () => clearInterval(t);
  }, [sleepMin]);

  const onState = useCallback(async (s: string) => {
    lastState.current = s;
    addLog(`state: ${s}`, s === 'playing' || s === 'paused');
    if (s === 'playing') {
      wantPlay.current = true;
      autoResumes.current = 0;
      setPlaying(true);
      // 動画ごとに最初の1回だけ、保存済みの位置から再開する
      try {
        const url = await playerRef.current?.getVideoUrl();
        const id = url ? videoIdFromUrl(url) : undefined;
        if (id && resumedFor.current !== id) {
          resumedFor.current = id;
          setCurrentId(id);
          const pos = await loadPosition(id);
          if (pos > 5) {
            playerRef.current?.seekTo(pos, true);
            addLog(`前回の位置 ${Math.floor(pos / 60)}分${pos % 60}秒 から再開`);
          }
        }
      } catch {}
    } else if (s === 'paused') {
      setPlaying(false);
      // 画面オフ直後の停止だけ自動で再開する(ロック画面での一時停止などは対象外)
      if (wantPlay.current && Date.now() - leftAt.current < AUTO_RESUME_WINDOW_MS) {
        if (autoResumes.current < MAX_AUTO_RESUMES) {
          autoResumes.current += 1;
          addLog(`画面オフ直後の停止を検知: 自動再開 ${autoResumes.current}回目`, true);
          setTimeout(() => setPlaying(true), 500);
        }
      }
    }
  }, []);

  const skip = async (delta: number) => {
    try {
      const cur = await playerRef.current?.getCurrentTime();
      if (cur !== undefined) playerRef.current?.seekTo(Math.max(0, cur + delta), true);
    } catch {}
  };

  const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.container}>
      <Pressable onPress={onBack} hitSlop={10}>
        <Text style={s.back}>← 戻る</Text>
      </Pressable>

      <Text style={s.title} numberOfLines={3}>
        {titleOf(currentId) || '再生中'}
      </Text>

      {/* 映像は小さなサムネイル程度。最初の1回だけ、中央の再生ボタンを直接タップして再生を始める */}
      <View style={{ width: playerW, height: playerH, alignSelf: 'center' }}>
        <YoutubeIframe
          key={webKey}
          ref={playerRef}
          height={playerH}
          width={playerW}
          videoId={ids[0]}
          playList={ids.length > 1 ? ids.slice(1) : undefined}
          play={playing}
          playbackRate={rate}
          onPlaybackRateChange={(r: number) => onRateChange(r)}
          onChangeState={onState}
          onReady={() => {
            readyRef.current = true;
            addLog('プレーヤー準備完了');
          }}
          onError={(e: string) => addLog(`error: ${e}`, true)}
          webViewProps={{
            allowsInlineMediaPlayback: true,
            mediaPlaybackRequiresUserAction: false,
            useSharedProcessPool: false, // 作り直しのとき、止まった古いWebプロセスを引き継がない
            onContentProcessDidTerminate: () => recoverRef.current('WebViewのプロセスが終了'),
            injectedJavaScriptBeforeContentLoaded: KEEP_VISIBLE_JS,
            injectedJavaScriptBeforeContentLoadedForMainFrameOnly: false,
          }}
        />
      </View>
      <Text style={s.hint}>再生が始まらないときは、上のサムネイルの再生ボタンを一度タップ</Text>

      <View style={s.row}>
        <Btn label="⟲ 15" onPress={() => skip(-15)} />
        <Btn label={playing ? '⏸ 一時停止' : '▶ 再生'} onPress={togglePlay} wide />
        <Btn label="15 ⟳" onPress={() => skip(15)} />
      </View>
      <View style={s.row}>
        <Chip label="⟳ 読み込み直す" active={false} onPress={() => recover('手動')} />
      </View>

      <Text style={s.label}>倍速</Text>
      <View style={s.row}>
        {RATES.map((r) => (
          <Chip key={r} label={`${r}x`} active={r === rate} onPress={() => onRateChange(r)} />
        ))}
      </View>

      <Text style={s.label}>スリープタイマー{sleepLeft > 0 ? `(残り ${fmt(sleepLeft)})` : ''}</Text>
      <View style={s.row}>
        {SLEEP_OPTIONS.map((m) => (
          <Chip
            key={m}
            label={m === 0 ? 'オフ' : `${m}分`}
            active={m === sleepMin}
            onPress={() => setSleepMin(m)}
          />
        ))}
      </View>

      {log.map((l, i) => (
        <Text key={i} style={s.log}>{l}</Text>
      ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function Btn({ label, onPress, wide }: { label: string; onPress: () => void; wide?: boolean }) {
  return (
    <Pressable style={[s.btn, wide && s.btnWide]} onPress={onPress}>
      <Text style={s.btnText}>{label}</Text>
    </Pressable>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[s.chip, active && s.chipActive]} onPress={onPress}>
      <Text style={s.chipText}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111' },
  container: { padding: 16, gap: 12 },
  back: { color: '#6cf', fontSize: 18, marginTop: 24, paddingVertical: 6 },
  title: { color: '#fff', fontSize: 18, fontWeight: '600' },
  hint: { color: '#888', fontSize: 12, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 10, justifyContent: 'center', flexWrap: 'wrap' },
  label: { color: '#aaa', marginTop: 8, fontSize: 14 },
  btn: { backgroundColor: '#2a2a2a', paddingVertical: 18, paddingHorizontal: 22, borderRadius: 10 },
  btnWide: { paddingHorizontal: 30, backgroundColor: '#1d5fd8' },
  btnText: { color: '#fff', fontSize: 20 },
  chip: { backgroundColor: '#2a2a2a', paddingVertical: 14, paddingHorizontal: 18, borderRadius: 22 },
  chipActive: { backgroundColor: '#1d5fd8' },
  chipText: { color: '#fff', fontSize: 17 },
  log: { color: '#777', fontSize: 11 },
});
