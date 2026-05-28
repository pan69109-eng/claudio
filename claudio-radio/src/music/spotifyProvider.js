import { searchTracks as spotifySearch, getPlaylistTracks as spotifyGetPlaylistTracks, getUserPlaylists as spotifyGetUserPlaylists, getUserPlaylistTracks as spotifyGetUserPlaylistTracks, getAllPlaylistTracks as spotifyGetAllPlaylistTracks, getLikedSongs as spotifyGetLikedSongs, getAudioFeatures as spotifyGetAudioFeatures } from '../spotify.js';

// 标准化 track 结构
function normalizeTrack(rawTrack) {
  return {
    id: rawTrack.id,
    source: 'spotify',
    name: rawTrack.name,
    artist: rawTrack.artist,
    album: rawTrack.album,
    albumArt: rawTrack.albumArt || null,
    uri: rawTrack.uri || null,
    playUrl: rawTrack.previewUrl || null,
    durationMs: rawTrack.durationMs || null,
    raw: rawTrack,
  };
}

// 搜索歌曲
export async function searchTracks(query) {
  const tracks = await spotifySearch(query);
  return tracks.map(normalizeTrack);
}

// 获取公开歌单歌曲
export async function getPlaylistTracks(playlistId) {
  const tracks = await spotifyGetPlaylistTracks(playlistId);
  return tracks.map(normalizeTrack);
}

// 获取用户歌单列表
export async function getUserPlaylists(userToken) {
  return spotifyGetUserPlaylists(userToken);
}

// 获取用户歌单歌曲
export async function getUserPlaylistTracks(userToken, playlistId, tracksHref) {
  const tracks = await spotifyGetUserPlaylistTracks(userToken, playlistId, tracksHref);
  return tracks.map(normalizeTrack);
}

// 分页获取整个歌单的歌曲（上限 500 首）
export async function getAllPlaylistTracks(userToken, playlistId, tracksHref, maxTracks) {
  const result = await spotifyGetAllPlaylistTracks(userToken, playlistId, tracksHref, maxTracks);
  return { tracks: result.tracks.map(normalizeTrack), total: result.total };
}

// 获取用户喜欢的歌曲
export async function getLikedSongs(userToken) {
  const tracks = await spotifyGetLikedSongs(userToken);
  return tracks.map(normalizeTrack);
}

// 获取歌曲的 audio features
export async function getAudioFeatures(trackIds, userToken) {
  return spotifyGetAudioFeatures(trackIds, userToken);
}

// 批量获取艺术家的 genres
export async function getArtistsGenres(artistIds, userToken) {
  return spotifyGetArtistsGenres(artistIds, userToken);
}
