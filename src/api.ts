// YouTube Data API v3 (公式)。チャンネルの再生リスト(Podcast)とエピソード一覧を取得する
const BASE = 'https://www.googleapis.com/youtube/v3';

export type Playlist = { id: string; title: string; count: number };
export type Episode = { id: string; title: string };

async function get(path: string, params: Record<string, string>, apiKey: string): Promise<any> {
  const qs = new URLSearchParams({ ...params, key: apiKey }).toString();
  const res = await fetch(`${BASE}/${path}?${qs}`);
  const json = await res.json();
  if (!res.ok) {
    const reason = json?.error?.errors?.[0]?.reason;
    if (reason === 'quotaExceeded') throw new Error('APIの1日の利用枠を超えました。明日また試してください');
    if (reason === 'keyInvalid' || reason === 'badRequest') throw new Error('APIキーが正しくありません');
    throw new Error(json?.error?.message ?? `API error ${res.status}`);
  }
  return json;
}

export async function findChannelId(handle: string, apiKey: string): Promise<string> {
  const h = handle.trim().startsWith('@') ? handle.trim() : `@${handle.trim()}`;
  const json = await get('channels', { part: 'id', forHandle: h }, apiKey);
  const id = json.items?.[0]?.id;
  if (!id) throw new Error(`チャンネルが見つかりません: ${h}`);
  return id;
}

export async function listPlaylists(channelId: string, apiKey: string): Promise<Playlist[]> {
  const out: Playlist[] = [];
  let pageToken = '';
  do {
    const json = await get(
      'playlists',
      { part: 'snippet,contentDetails', channelId, maxResults: '50', ...(pageToken && { pageToken }) },
      apiKey,
    );
    for (const it of json.items ?? []) {
      out.push({ id: it.id, title: it.snippet.title, count: it.contentDetails.itemCount });
    }
    pageToken = json.nextPageToken ?? '';
  } while (pageToken && out.length < 200);
  return out;
}

// 再生リストのエピソードを取得(削除済み・非公開は除く)。最大200件
export async function listEpisodes(playlistId: string, apiKey: string): Promise<Episode[]> {
  const out: Episode[] = [];
  let pageToken = '';
  do {
    const json = await get(
      'playlistItems',
      { part: 'snippet', playlistId, maxResults: '50', ...(pageToken && { pageToken }) },
      apiKey,
    );
    for (const it of json.items ?? []) {
      const title: string = it.snippet.title;
      if (title === 'Deleted video' || title === 'Private video') continue;
      out.push({ id: it.snippet.resourceId.videoId, title });
    }
    pageToken = json.nextPageToken ?? '';
  } while (pageToken && out.length < 200);
  return out;
}
