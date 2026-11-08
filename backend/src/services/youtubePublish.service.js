import { env } from '../config/env.js';

const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';
const API_URL = 'https://www.googleapis.com/youtube/v3';

export const getValidYouTubeAccessToken = async (user) => {
  const yt = user.youtube || {};
  if (!yt.accessToken && !yt.refreshToken) {
    const err = new Error('YouTube is not connected');
    err.statusCode = 400;
    throw err;
  }

  const expiresAt = yt.tokenExpiresAt ? new Date(yt.tokenExpiresAt).getTime() : 0;
  if (yt.accessToken && expiresAt && expiresAt > Date.now() + 60_000) {
    return yt.accessToken;
  }

  if (!yt.refreshToken) {
    if (yt.accessToken) return yt.accessToken;
    const err = new Error('YouTube is not connected');
    err.statusCode = 400;
    throw err;
  }

  const body = new URLSearchParams({
    client_id: env.youtubeClientId,
    client_secret: env.youtubeClientSecret,
    refresh_token: yt.refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error_description || data?.error || 'Failed to refresh YouTube token');
    err.statusCode = res.status;
    throw err;
  }

  user.youtube = user.youtube || {};
  user.youtube.accessToken = data.access_token;
  user.youtube.tokenExpiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000);
  await user.save();
  return data.access_token;
};

export const youtubeFetch = async (accessToken, url, options = {}) => {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `YouTube API failed (${res.status})`);
    err.statusCode = res.status;
    throw err;
  }
  return data;
};

export const listYouTubePlaylists = async (accessToken) => {
  const data = await youtubeFetch(
    accessToken,
    `${API_URL}/playlists?part=snippet&mine=true&maxResults=50`,
  );
  return (data.items || []).map((item) => ({
    id: item.id,
    title: item.snippet?.title || 'Untitled playlist',
  }));
};

export const publishYouTubeVideo = async (accessToken, metadata, mediaBuffer) => {
  const initRes = await fetch(
    `${UPLOAD_URL}?uploadType=resumable&part=snippet,status`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': metadata.mimeType || 'video/mp4',
        'X-Upload-Content-Length': String(mediaBuffer.length),
      },
      body: JSON.stringify({
        snippet: {
          title: metadata.title,
          description: metadata.description,
          tags: metadata.tags || [],
          categoryId: metadata.categoryId || '27',
        },
        status: {
          privacyStatus: metadata.visibility || 'private',
        },
      }),
    },
  );

  const initData = await initRes.json().catch(() => ({}));
  if (!initRes.ok) {
    const err = new Error(initData?.error?.message || `YouTube upload init failed (${initRes.status})`);
    err.statusCode = initRes.status;
    throw err;
  }

  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) {
    const err = new Error('YouTube did not return an upload URL');
    err.statusCode = 502;
    throw err;
  }

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': metadata.mimeType || 'video/mp4',
      'Content-Length': String(mediaBuffer.length),
    },
    body: mediaBuffer,
  });

  const uploadData = await uploadRes.json().catch(() => ({}));
  if (!uploadRes.ok) {
    const err = new Error(uploadData?.error?.message || `YouTube upload failed (${uploadRes.status})`);
    err.statusCode = uploadRes.status;
    throw err;
  }

  return uploadData;
};

export const addVideoToPlaylist = async (accessToken, playlistId, videoId) => {
  return youtubeFetch(accessToken, `${API_URL}/playlistItems?part=snippet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      snippet: {
        playlistId,
        resourceId: {
          kind: 'youtube#video',
          videoId,
        },
      },
    }),
  });
};

export const listYouTubeComments = async (accessToken, videoId) => {
  const data = await youtubeFetch(
    accessToken,
    `${API_URL}/commentThreads?part=snippet,replies&videoId=${encodeURIComponent(videoId)}&maxResults=50&order=time`,
  );
  return data.items || [];
};

export const replyYouTubeComment = async (accessToken, parentId, text) => {
  return youtubeFetch(accessToken, `${API_URL}/comments?part=snippet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      snippet: {
        parentId,
        textOriginal: text,
      },
    }),
  });
};

export const deletePlaylistItem = async (accessToken, playlistItemId) => {
  const res = await fetch(
    `${API_URL}/playlistItems?id=${encodeURIComponent(playlistItemId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error?.message || `Failed to remove playlist item (${res.status})`);
  }
  return true;
};

export const updateYouTubeVideo = async (accessToken, youtubeVideoId, metadata) => {
  const body = {
    id: youtubeVideoId,
    snippet: {
      title: metadata.title,
      description: metadata.description,
      tags: metadata.tags || [],
      categoryId: metadata.categoryId || '27',
    },
    status: {
      privacyStatus: metadata.visibility || 'private',
    },
  };
  return youtubeFetch(
    accessToken,
    `${API_URL}/videos?part=snippet,status`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
};

export const setYouTubeThumbnail = async (accessToken, videoId, imageBuffer, mimeType) => {
  const res = await fetch(
    `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': mimeType || 'image/jpeg',
      },
      body: imageBuffer,
    },
  );

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `YouTube thumbnail upload failed (${res.status})`);
    err.statusCode = res.status;
    throw err;
  }
  return data;
};
