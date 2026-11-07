"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AuthGuard } from "@/components/auth-guard";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/components/toast-provider";

type VideoDetail = {
  title?: string;
  aiMetadata?: {
    titles?: string[];
    descriptions?: string[];
    tags?: string[];
    summary?: string;
  };
  youtubeVisibility?: string;
  youtubeCategoryId?: string;
};

function PublishForm({ id, language }: { id: string; language: string }) {
  const router = useRouter();
  const toast = useToast();
  const [video, setVideo] = useState<VideoDetail | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [categoryId, setCategoryId] = useState("27");
  const [playlistId, setPlaylistId] = useState("");
  const [playlists, setPlaylists] = useState<{ id: string; title: string }[]>([]);
  const [ytConnected, setYtConnected] = useState(false);
  const [ytChannelTitle, setYtChannelTitle] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await api.get<{ video: VideoDetail }>(`/api/videos/${id}`);
      if (res.success && res.data?.video) {
        const v = res.data.video;
        setVideo(v);
        setTitle(v.aiMetadata?.titles?.[0] || `${v.title || "Lesson"} (${language})`);
        setDescription(v.aiMetadata?.descriptions?.[0] || v.aiMetadata?.summary || "");
        setTags((v.aiMetadata?.tags || []).join(", "));
        setVisibility(v.youtubeVisibility || "private");
        setCategoryId(v.youtubeCategoryId || "27");
      } else {
        toast.error(res.message || "Failed to load video.");
      }
    })();

    api.get<{ playlists: { id: string; title: string }[] }>("/api/videos/youtube/playlists").then((r) => {
      if (r.success && r.data?.playlists) setPlaylists(r.data.playlists);
    });
    api.get<{ connected?: boolean; channelTitle?: string | null }>("/api/auth/youtube/status").then((r) => {
      if (r.success) {
        setYtConnected(Boolean(r.data?.connected));
        setYtChannelTitle(r.data?.channelTitle || "");
      }
    });
  }, [id, language, toast]);

  const publish = async () => {
    setPublishing(true);
    const res = await api.post<{ youtubeUrl: string; youtubeVideoId: string }>(
      `/api/videos/${id}/lessons/${language}/publish`,
      {
        title,
        description,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        visibility,
        categoryId,
        playlistId: playlistId || undefined,
      },
    );
    setPublishing(false);
    if (res.success) {
      toast.success(res.message || "Published to YouTube.");
      setPublishedUrl(res.data?.youtubeUrl || null);
    } else {
      toast.error(res.message || "Publishing failed.");
    }
  };

  return (
    <AuthGuard>
      <div className="min-h-screen bg-muted/30">
        <header className="border-b bg-background">
          <div className="mx-auto flex max-w-3xl items-center justify-between p-4">
            <h1 className="text-lg font-semibold">Prepare YouTube Publish</h1>
            <button onClick={() => router.push(`/videos/${id}`)} className="text-sm underline">
              Back
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-3xl p-4">
          <Card>
            <CardHeader>
              <CardTitle>Review before publishing</CardTitle>
              <CardDescription>
                Language: {language}. Edit metadata then publish to YouTube.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!ytConnected && (
                <a href="/settings" className="text-sm underline">
                  Connect YouTube in Settings first.
                </a>
              )}
              <div className="space-y-2">
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full min-h-24 rounded-md border-2 border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="space-y-2">
                <Label>Tags (comma separated)</Label>
                <Input value={tags} onChange={(e) => setTags(e.target.value)} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Visibility</Label>
                  <select
                    value={visibility}
                    onChange={(e) => setVisibility(e.target.value)}
                    className="w-full h-9 rounded-md border-2 border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="private">Private</option>
                    <option value="unlisted">Unlisted</option>
                    <option value="public">Public</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Category ID</Label>
                  <Input value={categoryId} onChange={(e) => setCategoryId(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Destination channel</Label>
                <Input value={ytConnected ? ytChannelTitle || "Connected channel" : "Not connected"} readOnly />
              </div>
              <div className="space-y-2">
                <Label>Playlist</Label>
                <select
                  value={playlistId}
                  onChange={(e) => setPlaylistId(e.target.value)}
                  className="w-full h-9 rounded-md border-2 border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="">No playlist</option>
                  {playlists.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={publish} disabled={publishing || !ytConnected}>
                  {publishing ? "Publishing…" : "Publish to YouTube"}
                </Button>
                {publishedUrl && (
                  <a href={publishedUrl} target="_blank" rel="noreferrer" className="text-sm underline">
                    Open on YouTube
                  </a>
                )}
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </AuthGuard>
  );
}

function PublishPageClient() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = String(params?.id || "");
  const language = searchParams.get("language") || "en";
  return <PublishForm id={id} language={language} />;
}

export default function PublishPage() {
  return (
    <Suspense fallback={<div className="p-4">Loading…</div>}>
      <PublishPageClient />
    </Suspense>
  );
}
