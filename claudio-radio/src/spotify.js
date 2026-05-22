import { config } from './config.js';
import { logger } from './logger.js';

let accessToken = null;
let tokenExpiry = 0;

export async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken;
  }

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    throw new Error('Spotify认证失败');
  }

  const data = await response.json();
  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;

  logger.info('Spotify Token刷新成功');
  return accessToken;
}

export async function searchTracks(query) {
  try {
    const token = await getAccessToken();
    logger.info('Spotify搜索开始', { query, token: token.substring(0, 20) + '...' });

    const response = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=10`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    logger.info('Spotify响应状态', { status: response.status, ok: response.ok });

    if (!response.ok) {
      const errText = await response.text();
      logger.error('Spotify搜索失败', { status: response.status, error: errText });
      throw new Error('Spotify搜索失败');
    }

    const data = await response.json();
    logger.info('Spotify搜索结果', { total: data.tracks?.total, items: data.tracks?.items?.length });

    if (!data.tracks?.items || data.tracks.items.length === 0) {
      return [];
    }

    return data.tracks.items.map(track => ({
      id: track.id,
      name: track.name,
      artist: track.artists.map(a => a.name).join(', '),
      album: track.album.name,
      albumArt: track.album.images[0]?.url,
      previewUrl: track.preview_url,
      uri: track.uri,
    }));
  } catch (err) {
    logger.error('searchTracks异常', { error: err.message });
    throw err;
  }
}

export async function getPlaylistTracks(playlistId) {
  const token = await getAccessToken();
  const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/items?limit=50&additional_types=track`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error('获取歌单失败');
  }

  const data = await response.json();
  return mapPlaylistItems(data.items);
}

// 获取用户歌单列表（需要用户token）
async function readSpotifyError(response) {
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    const message = data.error?.message || data.error_description || text;
    const reason = data.error?.reason || data.error?.status || '';
    return reason ? `${message} (${reason})` : message;
  } catch {
    return text;
  }
}

function extractTrackCount(tracks) {
  if (!tracks) return 0;
  if (typeof tracks === 'number') return tracks;
  if (typeof tracks.total === 'number') return tracks.total;
  if (typeof tracks === 'object') {
    logger.warn('歌单 tracks 字段缺少 total', { tracksRaw: JSON.stringify(tracks) });
  }
  return 0;
}

export async function getUserPlaylists(userToken) {
  const response = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
    headers: { Authorization: `Bearer ${userToken}` }
  });
  if (!response.ok) {
    const detail = await readSpotifyError(response);
    logger.error('获取用户歌单失败', { status: response.status, detail });
    throw new Error(`获取用户歌单失败 (${response.status})`);
  }

  const data = await response.json();
  logger.debug('Spotify /me/playlists 原始响应', {
    sampleTracks: (data.items || []).slice(0, 5).map(p => ({
      id: p.id, name: p.name,
      tracksType: typeof p.tracks,
      itemsType: typeof p.items,
      itemsTotal: p.items?.total,
      tracksTotal: p.tracks?.total,
    }))
  });
  const playlists = (data.items || [])
    .filter(Boolean)
    .map(playlist => ({
      id: playlist.id,
      name: playlist.name || '未命名歌单',
      trackCount: extractTrackCount(playlist.items || playlist.tracks),
      uri: playlist.uri,
      owner: playlist.owner?.display_name || playlist.owner?.id || '',
      ownerId: playlist.owner?.id || '',
      isPublic: playlist.public,
      isCollaborative: playlist.collaborative,
      tracksHref: playlist.items?.href || playlist.tracks?.href || '',
      isLikedSongs: (playlist.items?.href || playlist.tracks?.href || '').includes('/me/tracks'),
    }))
    .filter(playlist => playlist.id);

  const accessible = await filterAccessiblePlaylists(playlists, userToken);
  logger.info('歌单可读性校验完成', { total: playlists.length, accessible: accessible.length, excluded: playlists.length - accessible.length });
  return accessible;
}

// 批量校验歌单可读性，排除返回非200的无权限歌单
async function filterAccessiblePlaylists(playlists, userToken) {
  const BATCH = 5;
  const accessible = [];
  for (let i = 0; i < playlists.length; i += BATCH) {
    const batch = playlists.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(p => {
        let url;
        if (p.isLikedSongs) {
          url = 'https://api.spotify.com/v1/me/tracks?limit=1';
        } else if (p.tracksHref) {
          // 直接用歌单自带的 items.href，追加 limit=1
          url = p.tracksHref.includes('?') ? `${p.tracksHref}&limit=1` : `${p.tracksHref}?limit=1`;
        } else {
          url = `https://api.spotify.com/v1/playlists/${p.id}/items?limit=1&additional_types=track`;
        }
        return fetch(url, {
          headers: { Authorization: `Bearer ${userToken}` }
        }).then(r => r.ok);
      })
    );
    for (let j = 0; j < results.length; j++) {
      if (results[j].status === 'fulfilled' && results[j].value) {
        accessible.push(batch[j]);
      } else {
        logger.warn('歌单无访问权限，已排除', { id: batch[j].id, name: batch[j].name });
      }
    }
  }
  return accessible;
}

// 获取指定歌单的歌曲列表（需要用户token，支持私有歌单）
export async function getUserPlaylistTracks(userToken, playlistId, tracksHref = '') {
  // 检测是否为 Liked Songs
  if (tracksHref.includes('/me/tracks')) {
    return getLikedSongs(userToken);
  }
  const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/items?limit=50&additional_types=track`, {
    headers: { Authorization: `Bearer ${userToken}` }
  });
  if (!response.ok) {
    const detail = await readSpotifyError(response);
    logger.error('获取歌单歌曲失败', { status: response.status, detail, playlistId });
    throw new Error(`获取歌单歌曲失败 (${response.status})`);
  }

  const data = await response.json();
  const tracks = mapPlaylistItems(data.items);
  logger.info('歌单歌曲解析完成', {
    playlistId,
    total: data.total,
    rawItems: data.items?.length || 0,
    parsedTracks: tracks.length
  });
  return tracks;
}

export async function getLikedSongs(userToken) {
  const response = await fetch('https://api.spotify.com/v1/me/tracks?limit=50', {
    headers: { Authorization: `Bearer ${userToken}` }
  });
  if (!response.ok) {
    const detail = await readSpotifyError(response);
    logger.error('获取喜欢的歌曲失败', { status: response.status, detail });
    throw new Error(`获取喜欢的歌曲失败 (${response.status})`);
  }
  const data = await response.json();
  const tracks = (data.items || [])
    .filter(item => item?.track?.type === 'track' && item.track.id && item.track.uri)
    .map(item => ({
      id: item.track.id,
      name: item.track.name,
      artist: item.track.artists?.map(a => a.name).join(', ') || '未知艺术家',
      album: item.track.album?.name || '',
      albumArt: item.track.album?.images?.[0]?.url,
      previewUrl: item.track.preview_url,
      uri: item.track.uri,
    }));
  logger.info('喜欢的歌曲解析完成', { total: data.total, parsedTracks: tracks.length });
  return tracks;
}

function mapPlaylistItems(items = []) {
  return items
    .map(item => item?.item || item?.track)
    .filter(track => track?.type === 'track' && track.id && track.uri)
    .map(track => ({
      id: track.id,
      name: track.name,
      artist: track.artists?.map(a => a.name).join(', ') || '未知艺术家',
      album: track.album?.name || '',
      albumArt: track.album?.images?.[0]?.url,
      previewUrl: track.preview_url,
      uri: track.uri,
    }));
}
