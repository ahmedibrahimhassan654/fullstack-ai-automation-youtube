export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export type ApiResponse<T = unknown> = {
  success: boolean;
  message?: string;
  data?: T;
  errors?: string[];
};

class ApiClient {
  private accessToken: string | null = null;

  setToken(token: string | null) {
    this.accessToken = token;
    if (token) localStorage.setItem('accessToken', token);
    else localStorage.removeItem('accessToken');
  }

  getToken(): string | null {
    if (this.accessToken) return this.accessToken;
    if (typeof window !== 'undefined') {
      this.accessToken = localStorage.getItem('accessToken');
    }
    return this.accessToken;
  }

  private async request<T>(path: string, options: RequestInit = {}, retry = true): Promise<ApiResponse<T>> {
    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');
    const token = this.getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      credentials: 'include',
    });

    if (res.status === 401 && retry) {
      // try refresh
      const refreshRes = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (refreshRes.ok) {
        const json = await refreshRes.json();
        if (json?.data?.accessToken) {
          this.setToken(json.data.accessToken);
          return this.request<T>(path, options, false);
        }
      } else {
        this.setToken(null);
      }
    }

    let json: ApiResponse<T> = { success: false };
    try {
      json = await res.json();
    } catch {
      // ignore parse errors
    }
    if (!res.ok && !json.message) {
      json.message = res.statusText;
    }
    return json;
  }

  get<T>(path: string) {
    return this.request<T>(path, { method: 'GET' });
  }

  post<T>(path: string, body?: unknown) {
    return this.request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
  }

  patch<T>(path: string, body?: unknown) {
    return this.request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined });
  }

  delete<T>(path: string) {
    return this.request<T>(path, { method: 'DELETE' });
  }

  async upload<T>(path: string, formData: FormData, onProgress?: (pct: number) => void): Promise<ApiResponse<T>> {
    const token = this.getToken();
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}${path}`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.withCredentials = true;

      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
      }

      xhr.onload = () => {
        let json: ApiResponse<T> = { success: false };
        try {
          json = JSON.parse(xhr.responseText);
        } catch {
          // ignore
        }
        if (xhr.status >= 400 && !json.message) json.message = xhr.statusText;
        resolve(json);
      };
      xhr.onerror = () => resolve({ success: false, message: 'Network error' });
      xhr.send(formData);
    });
  }
}

export const api = new ApiClient();
