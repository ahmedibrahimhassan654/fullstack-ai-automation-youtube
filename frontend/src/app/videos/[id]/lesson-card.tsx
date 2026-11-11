"use client";

import { useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api, API_BASE } from "@/lib/api";
import { useToast } from "@/components/toast-provider";

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

type LessonSegment = { start: number; end: number; text: string };

type LessonVideo = {
  language: string;
  url: string;
  voice?: string;
  durationSeconds?: number;
  script?: string;
  segments?: LessonSegment[];
  subtitlesUrl?: string | null;
  youtubeVideoId?: string | null;
  youtubeUrl?: string | null;
  youtubeChannelId?: string | null;
};

export default function LessonVideoCard({ videoId, lesson }: { videoId: string; lesson: LessonVideo }) {
  const toast = useToast();
  const [currentTime, setCurrentTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playlists, setPlaylists] = useState<{ id: string; title: string }[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState("");
  const [channels, setChannels] = useState<{ id: string; title: string; language?: string | null }[]>([]);
  const [channelId, setChannelId] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [ytConnected, setYtConnected] = useState(false);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    const onTimeUpdate = () => setCurrentTime(element.currentTime);
    element.addEventListener("timeupdate", onTimeUpdate);
    const onLoaded = () => {
      const track = element.textTracks?.[0];
      if (track) track.mode = "hidden";
    };
    element.addEventListener("loadedmetadata", onLoaded);
    return () => {
      element.removeEventListener("timeupdate", onTimeUpdate);
      element.removeEventListener("loadedmetadata", onLoaded);
    };
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    api.get<{ channels: { id: string; title: string; language?: string | null }[] }>("/api/videos/youtube/channels").then((r) => {
      if (!r.success || !r.data?.channels) return;
      const list = r.data.channels;
      setChannels(list);
      setChannelId((current) => {
        if (current && list.some((c) => c.id === current)) return current;
        if (lesson.youtubeChannelId && list.some((c) => c.id === lesson.youtubeChannelId)) {
          return lesson.youtubeChannelId;
        }
        // The lesson is in one language, so the channel of that language is
        // the right default.
        const wanted = lesson.language.toLowerCase().split("-")[0];
        const match = list.find((c) => (c.language || "").toLowerCase().split("-")[0] === wanted);
        return match?.id || list[0]?.id || "";
      });
    });
    api.get<{ connected?: boolean }>("/api/auth/youtube/status").then((r) => {
      if (r.success) setYtConnected(Boolean(r.data?.connected));
    });
  }, [lesson.language, lesson.youtubeChannelId]);

  // The playlists belong to a channel, and every channel can sit on another
  // Google account, so they have to be loaded for the selected channel.
  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    api
      .get<{ playlists: { id: string; title: string }[] }>(
        `/api/videos/youtube/playlists?channelId=${encodeURIComponent(channelId)}`,
      )
      .then((r) => {
        if (!cancelled && r.success && r.data?.playlists) setPlaylists(r.data.playlists);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const publishToYouTube = async () => {
    setPublishing(true);
    const res = await api.post<{ youtubeUrl: string; youtubeVideoId: string }>(
      `/api/videos/${videoId}/lessons/${lesson.language}/publish`,
      {
        source: "lesson",
        channelId: channelId || undefined,
        playlistId: selectedPlaylist || undefined,
        title: `${lesson.language.toUpperCase()} lesson: ${lesson.script?.slice(0, 60) || ""}`.trim(),
      },
    );
    if (res.success) {
      toast?.success?.(res.message || "Published to YouTube");
      (lesson as any).youtubeUrl = res.data?.youtubeUrl;
      (lesson as any).youtubeVideoId = res.data?.youtubeVideoId;
    } else {
      toast?.error?.(res.message || "Publishing failed.");
    }
    setPublishing(false);
  };

  const loadComments = async () => {
    if (!lesson.youtubeVideoId) return;
    setLoadingComments(true);
    const res = await api.get<{ comments: any[] }>(`/api/videos/youtube/videos/${lesson.youtubeVideoId}/comments`);
    if (res.success) setComments(res.data?.comments || []);
    setLoadingComments(false);
  };

  const sendReply = async (commentId: string) => {
    setReplyingId(commentId);
    const res = await api.post(`/api/videos/youtube/comments/${commentId}/reply`, {
      text: replyText,
      channelId: channelId || lesson.youtubeChannelId || undefined,
    });
    if (res.success) {
      setReplyText("");
      await loadComments();
    }
    setReplyingId(null);
  };

  const segments = lesson.segments || [];

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">
            {LANGUAGES.find((l) => l.code === lesson.language)?.label || lesson.language} ({lesson.language})
          </p>
          <p className="text-xs text-muted-foreground">
            {lesson.voice || "generated voice"}{lesson.durationSeconds ? ` • ${lesson.durationSeconds}s` : ""}
          </p>
        </div>
        <a
          href={lesson.url}
          target="_blank"
          rel="noreferrer"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Open generated file
        </a>
      </div>

      <video ref={videoRef} src={lesson.url} controls className="w-full rounded-md border" crossOrigin="anonymous">
        <track
          kind="subtitles"
          src={`${API_BASE}/api/videos/${videoId}/lessons/${lesson.language}/subtitles.vtt?token=${encodeURIComponent(api.getToken() || "")}`}
          srcLang={lesson.language}
          label={LANGUAGES.find((l) => l.code === lesson.language)?.label || lesson.language}
          default
        />
      </video>

      <div className="space-y-2 rounded-md border p-3">
        <div className="flex flex-wrap items-center gap-2">
          {ytConnected ? (
            <>
              <select
                value={channelId}
                onChange={(e) => {
                  setChannelId(e.target.value);
                  // The playlist belongs to the channel, so the old one
                  // cannot stay selected.
                  setSelectedPlaylist("");
                  setPlaylists([]);
                }}
                className="h-9 rounded-md border-2 border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                    {c.language ? ` — ${c.language}` : ""}
                  </option>
                ))}
              </select>
              <select
                value={selectedPlaylist}
                onChange={(e) => setSelectedPlaylist(e.target.value)}
                className="h-9 rounded-md border-2 border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="">No playlist</option>
                {playlists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
              <a href={`/videos/${videoId}/publish?language=${lesson.language}`} className={cn(buttonVariants({ size: "sm" }))}>
                Prepare to publish on YouTube
              </a>
            </>
          ) : (
            <a href="/settings" className="text-sm underline">
              Connect YouTube in Settings to publish.
            </a>
          )}
        </div>
        {(lesson as any).youtubeUrl && (
          <a href={(lesson as any).youtubeUrl} target="_blank" rel="noreferrer" className="text-sm underline">
            Open on YouTube
          </a>
        )}
      </div>

      <div className="space-y-2 rounded-md border p-3">
        <Button size="sm" variant="outline" onClick={loadComments} disabled={!(lesson as any).youtubeVideoId || loadingComments}>
          {loadingComments ? "Loading…" : "Load comments"}
        </Button>
        <div className="space-y-2">
          {comments.map((c) => (
            <div key={c.id} className="rounded border p-2 text-sm">
              <p className="font-medium">{c.snippet?.topLevelComment?.snippet?.authorDisplayName}</p>
              <p>{c.snippet?.topLevelComment?.snippet?.textDisplay}</p>
              <div className="mt-1 flex gap-2">
                <Input value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Reply…" className="h-8" />
                <Button size="sm" onClick={() => sendReply(c.snippet?.topLevelComment?.id)} disabled={replyingId === c.snippet?.topLevelComment?.id}>
                  Reply
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="max-h-96 space-y-2 overflow-y-auto rounded-md border p-2">
        {segments.length ? (
          segments.map((segment, index) => {
            const active =
              currentTime >= segment.start &&
              currentTime <= Math.max(segment.end, segment.start + 0.5);
            return (
              <button
                key={`${segment.start}-${index}`}
                type="button"
                onClick={() => {
                  if (videoRef.current) {
                    videoRef.current.currentTime = segment.start;
                    void videoRef.current.play();
                  }
                }}
                className={`block w-full rounded-md border px-2 py-1 text-left text-sm transition-colors ${
                  active ? "border-primary bg-primary/10 text-primary" : "border-transparent hover:bg-muted"
                }`}
              >
                <span className="mr-2 font-mono text-xs text-muted-foreground">{formatTime(segment.start)}</span>
                {segment.text}
              </button>
            );
          })
        ) : lesson.script ? (
          <p className="text-sm whitespace-pre-wrap">{lesson.script}</p>
        ) : null}
      </div>
    </div>
  );
}