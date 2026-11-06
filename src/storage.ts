// 設定と再生位置の保存(端末内のみ。APIキーもここに保存し、リポジトリやビルドには含めない)
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Episode } from './api';

export type Settings = { apiKey: string; handle: string; rate: number };

const SETTINGS_KEY = 'settings';
const POS_PREFIX = 'pos:';

export const DEFAULT_SETTINGS: Settings = { apiKey: '', handle: '@海外Yパパ', rate: 1 };

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {}
}

export async function loadPosition(videoId: string): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(POS_PREFIX + videoId);
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

export async function savePosition(videoId: string, seconds: number): Promise<void> {
  try {
    await AsyncStorage.setItem(POS_PREFIX + videoId, String(Math.floor(seconds)));
  } catch {}
}

// 最後に聞いていたキュー(プレイリスト)と動画。アプリを閉じても「続きから」できるようにする
export type LastSession = { queue: Episode[]; currentId: string };
const LAST_KEY = 'last';

export async function saveLast(s: LastSession): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_KEY, JSON.stringify(s));
  } catch {}
}

export async function loadLast(): Promise<LastSession | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_KEY);
    return raw ? (JSON.parse(raw) as LastSession) : null;
  } catch {
    return null;
  }
}

// 複数の動画の保存済み再生位置をまとめて取得(秒)
export async function loadPositions(ids: string[]): Promise<Record<string, number>> {
  try {
    const pairs = await AsyncStorage.multiGet(ids.map((id) => POS_PREFIX + id));
    const out: Record<string, number> = {};
    for (const [k, v] of pairs) if (v) out[k.slice(POS_PREFIX.length)] = Number(v) || 0;
    return out;
  } catch {
    return {};
  }
}

// 直近に開いたチャンネル/プレイリストの履歴(最大10件・重複なし)
export type Recent =
  | { kind: 'channel'; handle: string }
  | { kind: 'playlist'; id: string; title: string };
const RECENTS_KEY = 'recents';
const MAX_RECENTS = 10;

const sameRecent = (a: Recent, b: Recent) =>
  a.kind === 'channel' && b.kind === 'channel'
    ? a.handle.toLowerCase() === b.handle.toLowerCase()
    : a.kind === 'playlist' && b.kind === 'playlist' && a.id === b.id;

export async function loadRecents(): Promise<Recent[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as Recent[]) : [];
  } catch {
    return [];
  }
}

// 先頭に追加し、同じ項目は除いて10件に切る。更新後の一覧を返す
export async function addRecent(r: Recent): Promise<Recent[]> {
  const next = [r, ...(await loadRecents()).filter((x) => !sameRecent(x, r))].slice(0, MAX_RECENTS);
  try {
    await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

// 診断ログ(直近50件)。アプリを閉じても残り、再生トラブルの原因調べに使う
const LOG_KEY = 'diaglog';
const MAX_LOGS = 50;
let logQueue: Promise<void> = Promise.resolve();

export function appendDiagLog(line: string): void {
  logQueue = logQueue.then(async () => {
    try {
      const raw = await AsyncStorage.getItem(LOG_KEY);
      const logs: string[] = raw ? JSON.parse(raw) : [];
      logs.unshift(`${new Date().toLocaleString()} ${line}`);
      await AsyncStorage.setItem(LOG_KEY, JSON.stringify(logs.slice(0, MAX_LOGS)));
    } catch {}
  });
}

export async function loadDiagLogs(): Promise<string[]> {
  try {
    await logQueue;
    const raw = await AsyncStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function clearPosition(videoId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(POS_PREFIX + videoId);
  } catch {}
}
