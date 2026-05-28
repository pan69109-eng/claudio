import * as spotifyProvider from './spotifyProvider.js';

// 当前使用的音乐提供者
const providers = {
  spotify: spotifyProvider,
};

// 获取当前提供者（默认 spotify）
function getProvider(name = 'spotify') {
  const provider = providers[name];
  if (!provider) {
    throw new Error(`未知的音乐提供者: ${name}`);
  }
  return provider;
}

// 统一接口：搜索歌曲
export async function searchTracks(query, options = {}) {
  const provider = getProvider(options.provider);
  return provider.searchTracks(query);
}

// 统一接口：获取歌单歌曲
export async function getPlaylistTracks(playlistId, options = {}) {
  const provider = getProvider(options.provider);
  return provider.getPlaylistTracks(playlistId);
}

// 统一接口：获取用户歌单列表
export async function getUserPlaylists(options = {}) {
  const provider = getProvider(options.provider);
  return provider.getUserPlaylists(options.userToken);
}

// 统一接口：获取用户歌单歌曲
export async function getUserPlaylistTracks(playlistId, options = {}) {
  const provider = getProvider(options.provider);
  return provider.getUserPlaylistTracks(options.userToken, playlistId, options.tracksHref);
}

// 统一接口：分页获取整个歌单的歌曲（上限 500 首）
export async function getAllPlaylistTracks(playlistId, options = {}) {
  const provider = getProvider(options.provider);
  return provider.getAllPlaylistTracks(options.userToken, playlistId, options.tracksHref, options.maxTracks);
}

// 统一接口：获取用户喜欢的歌曲
export async function getLikedSongs(options = {}) {
  const provider = getProvider(options.provider);
  return provider.getLikedSongs(options.userToken);
}

// 统一接口：获取歌曲的 audio features
export async function getAudioFeatures(trackIds, options = {}) {
  const provider = getProvider(options.provider);
  return provider.getAudioFeatures(trackIds, options.userToken);
}

// 标准化 track 结构（供外部使用）
export function normalizeTrack(rawTrack, source = 'spotify') {
  const provider = getProvider(source);
  if (provider.normalizeTrack) {
    return provider.normalizeTrack(rawTrack);
  }
  // 默认标准化
  return {
    id: rawTrack.id,
    source,
    name: rawTrack.name,
    artist: rawTrack.artist,
    album: rawTrack.album,
    albumArt: rawTrack.albumArt || null,
    uri: rawTrack.uri || null,
    playUrl: rawTrack.previewUrl || rawTrack.playUrl || null,
    durationMs: rawTrack.durationMs || null,
    raw: rawTrack,
  };
}
