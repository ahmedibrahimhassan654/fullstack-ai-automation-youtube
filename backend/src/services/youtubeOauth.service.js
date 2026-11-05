import crypto from 'crypto';
import { env } from '../config/env.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels';

// Requested scopes to manage metadata + upload + identity.
const SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

export const buildYouTubeAuthUrl = (state) => {
  const params = new URLSearchParams({
    client_id: env.youtubeClientId,
    redirect_uri: env.youtubeRedirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
};

export const generateState = () => crypto.randomBytes(24).toString('hex');

export const exchangeCodeForTokens = async (code) => {
  const body = new URLSearchParams({
    code,
    client_id: env.youtubeClientId,
    client_secret: env.youtubeClientSecret,
    redirect_uri: env.youtubeRedirectUri,
    grant_type: 'authorization_code',
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error_description || data?.error || 'Failed to exchange YouTube code');
  }
  return data; // { access_token, refresh_token, expires_in, scope, token_type }
};

export const fetchYouTubeChannel = async (accessToken) => {
  const url = `${CHANNELS_URL}?part=snippet&mine=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || 'Failed to fetch YouTube channel');
  }
  const channel = data?.items?.[0];
  if (!channel) {
    throw new Error('No YouTube channel found for this Google account');
  }
  return {
    channelId: channel.id,
    channelTitle: channel.snippet?.title || null,
  };
};

export const refreshYouTubeAccessToken = async (refreshToken) => {
  const body = new URLSearchParams({
    client_id: env.youtubeClientId,
    client_secret: env.youtubeClientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error_description || data?.error || 'Failed to refresh YouTube token');
  }
  return data; // { access_token, expires_in, scope, token_type }
};
