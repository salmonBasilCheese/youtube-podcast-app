// 設定と再生位置の保存(端末内のみ。APIキーもここに保存し、リポジトリやビルドには含めない)
import AsyncStorage from '@react-native-async-storage/async-storage';

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

export async function clearPosition(videoId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(POS_PREFIX + videoId);
  } catch {}
}
