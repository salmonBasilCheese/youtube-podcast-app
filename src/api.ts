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

// 「@名前」「名前」「https://www.youtube.com/@名前」のどれでも「@名前」にそろえる
export function normalizeHandle(input: string): string {
  const s = input.trim();
  const fromUrl = s.match(/youtube\.com\/(@[^/?#\s]+)/)?.[1];
  const h = fromUrl ?? s;
  return h.startsWith('@') ? h : `@${h}`;
}

export async function findChannelId(handle: string, apiKey: string): Promise<string> {
  const h = normalizeHandle(handle);
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

// 再生リストのエピソードを取得(削除済み・非公開は除く)。既定は最大200件
export async function listEpisodes(
  playlistId: string,
  apiKey: string,
  limit = 200,
): Promise<Episode[]> {
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
  } while (pageToken && out.length < limit);
  return out.slice(0, limit);
}

// チャンネルの最新動画(ショート除外)。チャンネルID「UC…」を「UULF…」にした再生リストを使う。
// これはYouTubeの非公式な仕様のため、取得できないときはエラーにする
export async function listLatestVideos(
  channelId: string,
  apiKey: string,
  limit = 50,
): Promise<Episode[]> {
  if (!channelId.startsWith('UC')) throw new Error('最新動画を取得できないチャンネルです');
  try {
    const items = await listEpisodes(`UULF${channelId.slice(2)}`, apiKey, limit);
    if (items.length > 0) return items;
  } catch (e: any) {
    if (e?.message?.includes('利用枠')) throw e;
  }
  throw new Error('最新動画(ショート除外)を取得できませんでした');
}

export async function getPlaylistTitle(playlistId: string, apiKey: string): Promise<string> {
  const json = await get('playlists', { part: 'snippet', id: playlistId }, apiKey);
  const title = json.items?.[0]?.snippet?.title;
  if (!title) throw new Error('再生リストが見つかりません(非公開の可能性があります)');
  return title;
}
