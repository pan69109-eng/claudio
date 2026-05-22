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
  const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error('获取歌单失败');
  }

  const data = await response.json();
  return data.items.map(item => ({
    id: item.track.id,
    name: item.track.name,
    artist: item.track.artists.map(a => a.name).join(', '),
    album: item.track.album.name,
    albumArt: item.track.album.images[0]?.url,
    previewUrl: item.track.preview_url,
  }));
}