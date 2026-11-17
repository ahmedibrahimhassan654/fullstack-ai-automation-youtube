import { cookies } from 'next/headers';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

/**
 * Reads the httpOnly access-token cookie that the backend sets on login.
 * Returns null when the user is not authenticated (or the cookie expired).
 */
export async function getAccessToken(): Promise<string | null> {
  const store = await cookies();
  return store.get('accessToken')?.value ?? null;
}

async function fetchJson(path: string): Promise<any | null> {
  const token = await getAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data ?? null;
  } catch {
    return null;
  }
}

export async function fetchCourse(id: string): Promise<any | null> {
  const data = await fetchJson(`/api/courses/${id}`);
  return data?.course ?? null;
}

export async function fetchVideo(id: string): Promise<any | null> {
  const data = await fetchJson(`/api/videos/${id}`);
  return data?.video ?? null;
}
