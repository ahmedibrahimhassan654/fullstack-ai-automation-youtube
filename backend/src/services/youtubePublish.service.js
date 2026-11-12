import { env } from '../config/env.js';

const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';
const API_URL = 'https://www.googleapis.com/youtube/v3';

export const getValidYouTubeAccessToken = async (user, channelId = null) => {
  const yt = user.youtube || {};

  // The tokens belong to a Google account, not to a channel. When a channel
  // is given, use the account that owns it, so a course bound to another
  // channel is published to that channel.
  const owner = channelId
    ? (user.youtubeAccounts || []).find(
        (account) =>
          account.channelId === channelId ||
          (account.channels || []).some(
            (channel) => channel.channelId === channelId,
          ),
      ) || null
    : null;

  let accessToken = owner ? owner.accessToken : yt.accessToken;
  let refreshToken = owner ? owner.refreshToken : yt.refreshToken;
  let tokenExpiresAt = owner ? owner.tokenExpiresAt : yt.tokenExpiresAt;

  // The active connection may have lost its tokens while the account still
  // has them.
  if (!accessToken && !refreshToken) {
    const fallback = (user.youtubeAccounts || []).find((account) =>
      (account.channels || []).some(
        (channel) => channel.channelId === yt.channelId,
      ),
    );
    if (fallback?.accessToken || fallback?.refreshToken) {
      accessToken = fallback.accessToken;
      refreshToken = fallback.refreshToken;
      tokenExpiresAt = fallback.tokenExpiresAt;
    }
  }

  if (!accessToken && !refreshToken) {
    const err = new Error('YouTube is not connected');
    err.statusCode = 400;
    throw err;
  }

  const expiresAt = tokenExpiresAt ? new Date(tokenExpiresAt).getTime() : 0;
  if (accessToken && expiresAt && expiresAt > Date.now() + 60_000) {
    return accessToken;
  }

  if (!refreshToken) {
    if (accessToken) return accessToken;
    const err = new Error('YouTube is not connected');
    err.statusCode = 400;
    throw err;
  }

  const body = new URLSearchParams({
    client_id: env.youtubeClientId,
    client_secret: env.youtubeClientSecret,
    refresh_token: refreshToken,
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

  const newExpiry = new Date(Date.now() + (data.expires_in || 3600) * 1000);
  if (owner) {
    owner.accessToken = data.access_token;
    owner.tokenExpiresAt = newExpiry;
  } else {
    user.youtube = user.youtube || {};
    user.youtube.accessToken = data.access_token;
    user.youtube.tokenExpiresAt = newExpiry;
  }
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

export const listYouTubePlaylists = async (accessToken, channelId = null) => {
  // The API refuses `mine` together with `channelId` ("Incompatible
  // parameters specified in the request"), so a channel-scoped request has
  // to use `channelId` on its own.
  const query = channelId
    ? `part=snippet&channelId=${encodeURIComponent(channelId)}&maxResults=50`
    : `part=snippet&mine=true&maxResults=50`;
  const data = await youtubeFetch(accessToken, `${API_URL}/playlists?${query}`);
  return (data.items || []).map((item) => ({
    id: item.id,
    title: item.snippet?.title || 'Untitled playlist',
  }));
};

/** Creates a playlist on the channel the access token belongs to. */
export const createYouTubePlaylist = async (
  accessToken,
  { title, description = '', visibility = 'private' } = {},
) => {
  const data = await youtubeFetch(accessToken, `${API_URL}/playlists?part=snippet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      snippet: {
        title: String(title || 'Untitled playlist'),
        description: String(description || ''),
        privacyStatus: visibility,
      },
    }),
  });

  return {
    id: data.id,
    title: data.snippet?.title || title,
    url: `https://www.youtube.com/playlist?list=${data.id}`,
  };
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
          defaultAudioLanguage: metadata.videoLanguage || undefined,
          defaultCaptionLanguage: metadata.videoLanguage || undefined,
        },
        status: {
          privacyStatus: metadata.visibility || 'private',
          selfDeclaredMadeForKids: metadata.madeForKids ?? false,
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

/** Moves a playlist item to a zero-based position (requires manual ordering). */
export const updatePlaylistItemPosition = async (
  accessToken,
  playlistItemId,
  playlistId,
  videoId,
  position,
) => {
  return youtubeFetch(accessToken, `${API_URL}/playlistItems?part=snippet`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: playlistItemId,
      snippet: {
        playlistId,
        resourceId: { kind: 'youtube#video', videoId },
        position: Number(position) || 0,
      },
    }),
  });
};

/** Deletes a video from the channel. A missing video is treated as deleted. */
export const deleteYouTubeVideo = async (accessToken, videoId) => {
  const res = await fetch(
    `${API_URL}/videos?id=${encodeURIComponent(videoId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      data?.error?.message || `Failed to delete the video (${res.status})`,
    );
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
      defaultAudioLanguage: metadata.videoLanguage || undefined,
      defaultCaptionLanguage: metadata.videoLanguage || undefined,
    },
    status: {
      privacyStatus: metadata.visibility || 'private',
      selfDeclaredMadeForKids: metadata.madeForKids ?? false,
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
