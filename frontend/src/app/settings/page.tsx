'use client';

import { useEffect, useState } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { AppShell } from '@/components/app-shell';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/toast-provider';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Loader2, Unplug } from 'lucide-react';
import { cn } from '@/lib/utils';

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "ru", label: "Russian" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "tr", label: "Turkish" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
];

const languageLabel = (code?: string | null) =>
  LANGUAGES.find((l) => l.code === code)?.label || code || "Not set";

type YtChannel = {
  channelId: string;
  channelTitle?: string | null;
  language?: string | null;
};

type YtStatus = {
  connected: boolean;
  channelId?: string | null;
  channelTitle?: string | null;
  language?: string | null;
  channels?: YtChannel[];
  accounts?: (YtChannel & { channels?: YtChannel[] })[];
  connectedAt?: string | null;
};

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<YtStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectingChannel, setSelectingChannel] = useState(false);
  const [newChannelLanguage, setNewChannelLanguage] = useState(
    user?.preferences?.defaultLanguage || "ar",
  );
  const [savingLanguageFor, setSavingLanguageFor] = useState<string | null>(null);
  const [disconnectingChannel, setDisconnectingChannel] = useState<string | null>(null);

  const loadStatus = async () => {
    const res = await api.get<YtStatus>("/api/auth/youtube/status");
    if (res.success && res.data) setStatus(res.data as YtStatus);
  };

  useEffect(() => {
    (async () => {
      await loadStatus();
      setLoading(false);
    })();
  }, []);

  // Every channel the user can publish to, across all connected accounts.
  const allChannels: YtChannel[] = (() => {
    const seen = new Map<string, YtChannel>();
    for (const account of status?.accounts || []) {
      for (const channel of account.channels || []) {
        if (!seen.has(channel.channelId)) seen.set(channel.channelId, channel);
      }
      if (account.channelId && !seen.has(account.channelId)) {
        seen.set(account.channelId, {
          channelId: account.channelId,
          channelTitle: account.channelTitle,
          language: account.language ?? null,
        });
      }
    }
    for (const channel of status?.channels || []) {
      if (!seen.has(channel.channelId)) seen.set(channel.channelId, channel);
    }
    return [...seen.values()];
  })();

  /** Starts the Google flow to add another channel, tagged with a language. */
  const addChannel = async () => {
    const res = await api.post<{ url: string }>("/api/auth/youtube/connect", {
      language: newChannelLanguage,
    });
    if (res.success && res.data?.url) {
      window.location.href = res.data.url;
    } else {
      toast.error(res.message || "Failed to start YouTube connection.");
    }
  };

  /** Changes the language of a channel without making it the default one. */
  const setChannelLanguage = async (channelId: string, language: string) => {
    setSavingLanguageFor(channelId);
    const res = await api.post("/api/auth/youtube/channel-language", {
      channelId,
      language,
    });
    if (res.success) {
      toast.success(res.message || "Channel language updated.");
      await loadStatus();
      await refreshUser();
    } else {
      toast.error(res.message || "Failed to update the channel language.");
    }
    setSavingLanguageFor(null);
  };

  const disconnect = async () => {
    const res = await api.post('/api/auth/youtube/disconnect');
    if (res.success) {
      toast.success(res.message || 'YouTube disconnected.');
    } else {
      toast.error(res.message || 'Failed to disconnect YouTube.');
    }
    await loadStatus();
    await refreshUser();
  };

  /** Removes a single channel, keeping the other ones connected. */
  const disconnectChannel = async (channel: YtChannel) => {
    const title = channel.channelTitle || channel.channelId;
    if (
      !window.confirm(
        `Disconnect "${title}"? It will no longer be available for publishing.`,
      )
    )
      return;

    setDisconnectingChannel(channel.channelId);
    const res = await api.post('/api/auth/youtube/channel-disconnect', {
      channelId: channel.channelId,
    });
    if (res.success) {
      toast.success(res.message || "Channel disconnected.");
      await loadStatus();
      await refreshUser();
    } else {
      toast.error(res.message || "Failed to disconnect the channel.");
    }
    setDisconnectingChannel(null);
  };

  const selectChannel = async (channelId: string) => {
    setSelectingChannel(true);
    const res = await api.post<YtStatus>('/api/auth/youtube/channel', { channelId });
    if (res.success) {
      toast.success("Default channel updated.");
      await loadStatus();
      await refreshUser();
    } else {
      toast.error(res.message || "Failed to update channel.");
    }
    setSelectingChannel(false);
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
      <AppShell title="Settings" description="YouTube channel and account">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>YouTube Channels</CardTitle>
              <CardDescription>
                Connect the channels you publish to and tell the app which
                language each one is in.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <>
                  {/* Add a new channel */}
                  <div className="space-y-3 rounded-lg border border-dashed p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <div className="flex-1 space-y-1.5">
                        <Label htmlFor="newChannelLanguage">
                          Language for the new channel
                        </Label>
                        <select
                          id="newChannelLanguage"
                          value={newChannelLanguage}
                          onChange={(e) => setNewChannelLanguage(e.target.value)}
                          className="h-9 w-full rounded-md border-2 border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                        >
                          {LANGUAGES.map((language) => (
                            <option key={language.code} value={language.code}>
                              {language.label} ({language.code})
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-muted-foreground">
                          Used as the default dubbing and lesson language for this
                          channel.
                        </p>
                      </div>
                      <Button onClick={addChannel} className="sm:w-auto">
                        {status?.connected ? "Add channel" : "Connect YouTube"}
                      </Button>
                    </div>
                  </div>

                  {allChannels.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-sm font-medium">Connected channels</p>
                      <div className="space-y-2">
                        {allChannels.map((channel) => {
                          const isDefault = channel.channelId === status?.channelId;
                          return (
                            <div
                              key={channel.channelId}
                              className={cn(
                                "flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between",
                                isDefault && "border-primary/50 bg-primary/5",
                              )}
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="truncate font-medium">
                                    {channel.channelTitle || channel.channelId}
                                  </span>
                                  {isDefault && (
                                    <Badge variant="default" className="shrink-0">
                                      Default
                                    </Badge>
                                  )}
                                </div>
                                <p className="truncate text-xs text-muted-foreground">
                                  {channel.channelId}
                                </p>
                              </div>

                              <div className="flex items-center gap-2">
                                <select
                                  aria-label={`Language for ${channel.channelTitle || channel.channelId}`}
                                  value={channel.language || ""}
                                  disabled={savingLanguageFor === channel.channelId}
                                  onChange={(e) =>
                                    setChannelLanguage(channel.channelId, e.target.value)
                                  }
                                  className="h-9 rounded-md border-2 border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                                >
                                  <option value="">No language</option>
                                  {LANGUAGES.map((language) => (
                                    <option key={language.code} value={language.code}>
                                      {language.label} ({language.code})
                                    </option>
                                  ))}
                                </select>
                                {!isDefault && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={selectingChannel}
                                    onClick={() => selectChannel(channel.channelId)}
                                  >
                                    Make default
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={disconnectingChannel === channel.channelId}
                                  title="Disconnect this channel"
                                  aria-label={`Disconnect ${channel.channelTitle || channel.channelId}`}
                                  onClick={() => disconnectChannel(channel)}
                                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                >
                                  {disconnectingChannel === channel.channelId ? (
                                    <Loader2 className="size-4 animate-spin" />
                                  ) : (
                                    <Unplug className="size-4" />
                                  )}
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {status?.connected && (
                    <div className="flex items-center justify-between border-t pt-4">
                      <p className="text-xs text-muted-foreground">
                        Default channel: {status.channelTitle} ·{" "}
                        {languageLabel(status.language)}
                      </p>
                      <Button variant="destructive" size="sm" onClick={disconnect}>
                        Disconnect
                      </Button>
                    </div>
                  )}
                </>
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
        </div>
      </AppShell>
    </AuthGuard>
  );
}
