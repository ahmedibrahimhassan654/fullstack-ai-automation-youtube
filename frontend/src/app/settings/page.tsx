'use client';

import { useEffect, useState } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/toast-provider';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type YtStatus = {
  connected: boolean;
  channelId?: string | null;
  channelTitle?: string | null;
  connectedAt?: string | null;
};

export default function SettingsPage() {
  const { user, refreshUser, logout } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [status, setStatus] = useState<YtStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await api.get<YtStatus>('/api/auth/youtube/status');
      if (res.success && res.data) setStatus(res.data as YtStatus);
      setLoading(false);
    })();
  }, []);

  const connect = async () => {
    const res = await api.get<{ url: string }>('/api/auth/youtube/connect');
    if (res.success && res.data?.url) {
      window.location.href = res.data.url;
    } else {
      toast.error(res.message || 'Failed to start YouTube connection.');
    }
  };

  const disconnect = async () => {
    const res = await api.post('/api/auth/youtube/disconnect');
    if (res.success) {
      toast.success(res.message || 'YouTube disconnected.');
    } else {
      toast.error(res.message || 'Failed to disconnect YouTube.');
    }
    const statusRes = await api.get<YtStatus>('/api/auth/youtube/status');
    if (statusRes.success && statusRes.data) setStatus(statusRes.data as YtStatus);
    await refreshUser();
  };

  // Read callback result from query string
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const state = params.get('youtube');
    if (state === 'connected' || state === 'error') {
      api.get<YtStatus>('/api/auth/youtube/status').then((r) => {
        if (r.success && r.data) setStatus(r.data as YtStatus);
      });
    }
  }, []);

  return (
    <AuthGuard>
      <div className="min-h-screen bg-muted/30">
        <header className="border-b bg-background">
          <div className="mx-auto flex max-w-3xl items-center justify-between p-4">
            <h1 className="text-lg font-semibold">Settings</h1>
            <Link href="/dashboard" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
              Back
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await logout();
                  toast.success("Logged out successfully.");
                  router.push("/login");
                } catch {
                  toast.error("Logout failed. Please try again.");
                }
              }}
            >
              Log out
            </Button>
          </div>
        </header>
        <main className="mx-auto max-w-3xl p-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>YouTube Channel</CardTitle>
              <CardDescription>Connect your channel to publish videos directly.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : status?.connected ? (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="default">Connected</Badge>
                      <span className="font-medium">{status.channelTitle}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{status.channelId}</p>
                  </div>
                  <Button variant="destructive" size="sm" onClick={disconnect}>
                    Disconnect
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Not connected.</p>
                  <Button onClick={connect}>Connect YouTube</Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p><span className="font-medium">Name:</span> {user?.name}</p>
              <p><span className="font-medium">Email:</span> {user?.email}</p>
              <p><span className="font-medium">Role:</span> {user?.role}</p>
              <p><span className="font-medium">Plan:</span> {user?.subscription?.plan}</p>
            </CardContent>
          </Card>
        </main>
      </div>
    </AuthGuard>
  );
}
