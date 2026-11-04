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

export async function clearPosition(videoId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(POS_PREFIX + videoId);
  } catch {}
}
