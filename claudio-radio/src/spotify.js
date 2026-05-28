import { config } from './config.js';
import { logger } from './logger.js';

let accessToken = null;
let tokenExpiry = 0;

// 带重试的 fetch 包装函数（指数退避 + jitter）
export async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // 503 或 429 时重试
      if ((response.status === 503 || response.status === 429) && attempt < maxRetries) {
        const retryAfter = response.headers.get('Retry-After');
        const baseWait = retryAfter ? parseInt(retryAfter) : Math.pow(2, attempt);
        const jitter = Math.random() * 1000; // 0-1s 随机抖动
        const waitMs = baseWait * 1000 + jitter;

        logger.warn('Spotify API 临时不可用，准备重试', {
          status: response.status,
          attempt: attempt + 1,
          maxRetries,
          waitMs: Math.round(waitMs)
        });

        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }

      return response;
    } catch (err) {
      // 网络错误时重试
      if (attempt < maxRetries) {
        const waitMs = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        logger.warn('Spotify API 网络错误，准备重试', {
          error: err.message,
          attempt: attempt + 1,
          maxRetries,
          waitMs: Math.round(waitMs)
        });
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }
      throw err;
    }
  }
}

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
export async function readSpotifyError(response) {
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
  const response = await fetchWithRetry('https://api.spotify.com/v1/me/playlists?limit=50', {
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
  const response = await fetchWithRetry(`https://api.spotify.com/v1/playlists/${playlistId}/items?limit=50&additional_types=track`, {
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

// 分页获取整个歌单的歌曲（上限 500 首）
export async function getAllPlaylistTracks(userToken, playlistId, tracksHref = '', maxTracks = 500) {
  // 检测是否为 Liked Songs
  if (tracksHref.includes('/me/tracks')) {
    return getAllLikedSongs(userToken, maxTracks);
  }

  const allTracks = [];
  let offset = 0;
  const limit = 50;
  let total = 0;

  while (allTracks.length < maxTracks) {
    const url = `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=${limit}&offset=${offset}&additional_types=track`;
    const response = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${userToken}` }
    });

    if (!response.ok) {
      const detail = await readSpotifyError(response);
      logger.error('分页获取歌单失败', { status: response.status, detail, playlistId, offset });
      throw new Error(`分页获取歌单失败 (${response.status})`);
    }

    const data = await response.json();
    total = data.total || 0;

    if (!data.items || data.items.length === 0) break;

    const tracks = mapPlaylistItems(data.items);
    allTracks.push(...tracks);

    // 如果已经获取完所有歌曲，退出
    if (allTracks.length >= total || data.next === null) break;

    offset += limit;
  }

  const result = allTracks.slice(0, maxTracks);
  logger.info('歌单全量获取完成', { playlistId, total, fetched: result.length, maxTracks });
  return { tracks: result, total };
}

// 分页获取用户喜欢的歌曲（上限 500 首）
async function getAllLikedSongs(userToken, maxTracks = 500) {
  const allTracks = [];
  let offset = 0;
  const limit = 50;
  let total = 0;

  while (allTracks.length < maxTracks) {
    const url = `https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`;
    const response = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${userToken}` }
    });

    if (!response.ok) {
      const detail = await readSpotifyError(response);
      logger.error('分页获取喜欢歌曲失败', { status: response.status, detail, offset });
      throw new Error(`分页获取喜欢歌曲失败 (${response.status})`);
    }

    const data = await response.json();
    total = data.total || 0;

    if (!data.items || data.items.length === 0) break;

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

    allTracks.push(...tracks);

    if (allTracks.length >= total || data.next === null) break;

    offset += limit;
  }

  const result = allTracks.slice(0, maxTracks);
  logger.info('喜欢歌曲全量获取完成', { total, fetched: result.length, maxTracks });
  return { tracks: result, total };
}

export async function getLikedSongs(userToken) {
  const response = await fetchWithRetry('https://api.spotify.com/v1/me/tracks?limit=50', {
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

// 批量获取歌曲的 audio features（最多 100 首/次）
export async function getAudioFeatures(trackIds, userToken) {
  const token = userToken || await getAccessToken();
  const results = [];

  // 分批处理，每批最多 100 首
  for (let i = 0; i < trackIds.length; i += 100) {
    const batch = trackIds.slice(i, i + 100);
    const response = await fetch(`https://api.spotify.com/v1/audio-features?ids=${batch.join(',')}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      const detail = await readSpotifyError(response);
      logger.error('获取 audio features 失败', { status: response.status, detail });
      throw new Error(`获取 audio features 失败 (${response.status})`);
    }

    const data = await response.json();
    if (data.audio_features) {
      results.push(...data.audio_features.filter(Boolean));
    }
  }

  logger.info('Audio features 获取完成', { total: results.length });
  return results;
}
