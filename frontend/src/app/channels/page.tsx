"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ListVideo, Tv } from "lucide-react";
import { AuthGuard } from "@/components/auth-guard";
import { AppShell } from "@/components/app-shell";
import { useToast } from "@/components/toast-provider";
import { api } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { languageLabel } from "@/lib/languages";

type Channel = {
  channelId: string;
  channelTitle?: string | null;
  language?: string | null;
  playlists: { id: string; title: string; description?: string }[];
};

export default function ChannelsPage() {
  const toast = useToast();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await api.get<{ channels: Channel[] }>("/api/courses/channels");
      if (res.success) setChannels(res.data?.channels || []);
      else toast.error(res.message || "Failed to load the channels.");
      setLoading(false);
    })();
  }, [toast]);

  return (
    <AuthGuard>
      <AppShell
        title="Channels"
        description="Every YouTube channel you publish to, with its playlists"
      >
        <div className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : channels.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">
                  No YouTube channel connected yet. Connect one in Settings to
                  publish courses.
                </p>
              </CardContent>
            </Card>
          ) : (
            channels.map((channel) => (
              <Link
                key={channel.channelId}
                href={`/channels/${channel.channelId}`}
                className="flex items-center gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/50"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 text-white">
                  <Tv className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">
                      {channel.channelTitle || channel.channelId}
                    </p>
                    {channel.language && (
                      <Badge variant="secondary">{channel.language}</Badge>
                    )}
                    <Badge variant="outline">
                      <ListVideo className="size-3" />
                      {channel.playlists.length} playlist
                      {channel.playlists.length === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {channel.language
                      ? `Publishes in ${languageLabel(channel.language)}`
                      : "No language set"}
                  </p>
                </div>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            ))
          )}
        </div>
      </AppShell>
    </AuthGuard>
  );
}
