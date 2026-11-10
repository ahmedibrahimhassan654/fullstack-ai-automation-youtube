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

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = String(text || "").trim().split(/\\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth || !current) {
      current = test;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function createCanvasThumbnailDataUrl(title: string, language: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const isArabic = language.toLowerCase().startsWith("ar");

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#081229");
  gradient.addColorStop(0.55, "#102a5c");
  gradient.addColorStop(1, "#1f4f99");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Accent glow and subtle shapes.
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#ff8a00";
  ctx.beginPath();
  ctx.arc(1080, 180, 220, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < 18; i += 1) {
    const x = (i * 97) % canvas.width;
    const y = (i * 53) % canvas.height;
    ctx.fillRect(x, y, 4, 4);
  }
  ctx.globalAlpha = 1;

  // Bottom title panel.
  ctx.fillStyle = "rgba(0, 0, 0, 0.38)";
  ctx.fillRect(0, 430, canvas.width, 290);

  ctx.direction = isArabic ? "rtl" : "ltr";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 74px 'Segoe UI', 'Tahoma', sans-serif";

  const safeTitle = (title || "Lesson").slice(0, 90);
  const lines = wrapCanvasText(ctx, safeTitle, 1080).slice(0, 3);
  const lineHeight = 86;
  const startY = 500 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => {
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillText(line, canvas.width / 2 + 4, startY + index * lineHeight + 4);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(line, canvas.width / 2, startY + index * lineHeight);
  });

  // Accent underline.
  ctx.fillStyle = "#ff8a00";
  ctx.fillRect(canvas.width / 2 - 180, startY + lines.length * lineHeight - 18, 360, 8);

  // Small subtitle badge.
  ctx.font = "bold 30px 'Segoe UI', 'Tahoma', sans-serif";
  ctx.fillStyle = "#ff8a00";
  ctx.fillText(isArabic ? "دورة تعليمية" : "Course lesson", canvas.width / 2, 405);

  return canvas.toDataURL("image/png");
}

type LessonPublishInfo = {
  language?: string;
  source?: "lesson" | "dub";
  url?: string | null;
  durationSeconds?: number | null;
  youtubeVideoId?: string | null;
  youtubeUrl?: string | null;
  youtubePublishedAt?: string | null;
  youtubeChannelTitle?: string | null;
  youtubeChannelId?: string | null;
  youtubePlaylistId?: string | null;
  youtubeVisibility?: string | null;
  youtubeCategoryId?: string | null;
  youtubeTitle?: string | null;
  youtubeDescription?: string | null;
  youtubeTags?: string[] | null;
  thumbnailUrl?: string | null;
};
function lessonNumberFrom(value?: string | null) {
  const match = String(value || "").trim().match(/^(\d+)/);
  return match ? match[1] : null;
}

type VideoDetail = {
  title?: string;
  originalFilename?: string | null;
  attachments?: { name?: string; type?: string; url?: string | null }[];
  transcriptLanguage?: string;
  translations?: { language: string; transcript?: string }[];
  lessonVideos?: LessonPublishInfo[];
  dubs?: { language?: string; url?: string | null; durationSeconds?: number | null; voice?: string | null }[];
  aiMetadata?: {
    titles?: string[];
    descriptions?: string[];
    tags?: string[];
    chapters?: { time?: string; title?: string }[];
    summary?: string;
    keyPoints?: string[];
    openQuestions?: string[];
  };
  youtubeVisibility?: string;
  youtubeCategoryId?: string;
  thumbnailUrl?: string | null;
};

function PublishForm({ id, language, voice: voiceParam }: { id: string; language: string; voice?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [video, setVideo] = useState<VideoDetail | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [categoryId, setCategoryId] = useState("27");
  const [playlistId, setPlaylistId] = useState("");
  const [playlists, setPlaylists] = useState<{ id: string; title: string }[]>([]);
  const [channels, setChannels] = useState<{ id: string; title: string }[]>([]);
  const [channelId, setChannelId] = useState("");
  const [ytConnected, setYtConnected] = useState(false);
  const [ytChannelTitle, setYtChannelTitle] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [source, setSource] = useState<"lesson" | "dub">("lesson");
  const dubsForLanguage = (video?.dubs || []).filter((d) => d.language === language && d.url);
  const dubForLanguage =
    (voiceParam ? dubsForLanguage.find((d) => d.voice === voiceParam) : undefined) || dubsForLanguage[0];
  const lessonForLanguage = (video?.lessonVideos || []).find(
    (l) => l.language === language && (l.source ?? "lesson") === "lesson",
  );
  const existingPublish = (video?.lessonVideos || []).find(
    (l) =>
      l.language === language &&
      (l.source ?? "lesson") === source &&
      (source !== "dub" ||
        !dubForLanguage ||
        String(l.voice ?? "") === String(dubForLanguage.voice ?? "")),
  );

  const load = async () => {
    const res = await api.get<{ video: VideoDetail; metadata?: VideoDetail["aiMetadata"]; language?: string }>(
      `/api/videos/${id}/publish-prefill?language=${encodeURIComponent(language)}`,
    );
    if (res.success && res.data?.video) {
        const v = res.data.video;
        setVideo(v);
        const meta = res.data?.metadata || v.aiMetadata || {};
        const isArabic = language.toLowerCase().startsWith("ar");
        const labels = isArabic
          ? {
              summary: "📌 ملخص الفيديو",
              description: "📝 وصف الفيديو",
              chapters: "⏱️ الفصول",
              keyPoints: "💡 نقاط رئيسية",
              questions: "❓ أسئلة",
            }
          : {
              summary: "📌 Video summary",
              description: "📝 Description",
              chapters: "⏱️ Chapters",
              keyPoints: "💡 Key points",
              questions: "❓ Questions",
            };
        const summary = (meta.summary || "").trim();
        const descriptionText = (meta.descriptions?.[0] || "").trim();
        const chapters = (meta.chapters || [])
          .filter((c) => c?.title)
          .map((c) => `${c.time || "00:00"} - ${c.title}`)
          .join("\n");
        const keyPoints = (meta.keyPoints || []).map((p) => `- ${p}`).join("\n");
        const questions = (meta.openQuestions || []).map((q) => `- ${q}`).join("\n");
        const hashtags = (meta.tags || [])
          .map((tag) => `#${String(tag).trim().replace(/\s+/g, "")}`)
          .filter((tag) => tag !== "#")
          .join(" ");
        const opening = (descriptionText || summary || "").trim();
        const pointLines = (meta.keyPoints || [])
          .map((p) => `🔹 ${String(p).trim()}`)
          .filter(Boolean)
          .join("\n");
        const chapterLines = (meta.chapters || [])
          .filter((c) => c?.title)
          .map((c) => `${c.time || "00:00"} — ${c.title}`)
          .join("\n");
        const body = [opening, pointLines, (meta.openQuestions || []).length ? `❓ ${(meta.openQuestions || []).join(" ")}` : ""]
          .filter(Boolean)
          .join("\n");
        const resourceLinks = (v.attachments || [])
          .filter((a) => a?.url)
          .map((a) => `- ${a?.name || a.url}: ${a.url}`)
          .join("\n");
        const courseNav = `Course navigation: Review the full playlist and next steps on the channel. Details: ${window.location.origin}/videos/${id}`;
        const composedDescription = [
          body,
          chapterLines ? `-----------------------------------------------------------------------------------------------------\n${chapterLines}` : "",
          resourceLinks ? `🔗 Resources, commands, and links:\n${resourceLinks}` : "",
          `🧭 ${courseNav}`,
          (meta.openQuestions || []).length ? `❓ ${(meta.openQuestions || []).join(" ")}` : "",
          hashtags ? `🏷️ ${hashtags}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");

        const dubForLang = (v.dubs || []).find(
          (d) => d.language === language && d.url && (!voiceParam || d.voice === voiceParam),
        ) || (v.dubs || []).find((d) => d.language === language && d.url);
        const publishedRecord = (v.lessonVideos || []).find(
          (item) => item.language === language && item.youtubeVideoId,
        );
        const nextSource: "lesson" | "dub" = publishedRecord
          ? ((publishedRecord.source as "lesson" | "dub") || "lesson")
          : dubForLang
            ? "dub"
            : "lesson";
        setSource(nextSource);
        const existingPublishLesson = (v.lessonVideos || []).find(
          (item) =>
            item.language === language &&
            (item.source ?? "lesson") === nextSource &&
            (nextSource !== "dub" || String(item.voice ?? "") === String(dubForLang?.voice ?? "")),
        );
        const preferredTitle = existingPublishLesson?.youtubeTitle || meta.titles?.[0] || `${v.title || "Lesson"} (${language})`;
        const lessonNumber = lessonNumberFrom(v.title) || lessonNumberFrom(v.originalFilename);
        const titledWithNumber =
          lessonNumber && !String(preferredTitle).trim().match(/^\d+/)
            ? `${lessonNumber}. ${preferredTitle}`
            : preferredTitle;
        setTitle(titledWithNumber);
        setDescription(existingPublishLesson?.youtubeDescription || composedDescription);
        setTags(((existingPublishLesson?.youtubeTags && existingPublishLesson.youtubeTags.length ? existingPublishLesson.youtubeTags : (meta.tags || [])) as string[]).join(", "));
        setVisibility(existingPublishLesson?.youtubeVisibility || v.youtubeVisibility || "private");
        setCategoryId(existingPublishLesson?.youtubeCategoryId || v.youtubeCategoryId || "27");
        setPlaylistId(existingPublishLesson?.youtubePlaylistId || "");
        setThumbnailUrl(existingPublishLesson?.thumbnailUrl || v.thumbnailUrl || "");
        if (existingPublishLesson?.youtubeChannelId) setChannelId(existingPublishLesson.youtubeChannelId);
        if (!v.thumbnailUrl && !existingPublishLesson?.thumbnailUrl) {
          const titleText = meta.titles?.[0] || v.title || "Lesson";
          const dataUrl = createCanvasThumbnailDataUrl(titleText, language);
          if (dataUrl) {
            api
              .post<{ thumbnailUrl: string }>(`/api/videos/${id}/thumbnail`, {
                thumbnailDataUrl: dataUrl,
              })
              .then((r) => {
                if (r.success && r.data?.thumbnailUrl) setThumbnailUrl(r.data.thumbnailUrl);
              });
          }
        }
        setCategoryId(v.youtubeCategoryId || "27");

      } else {
        toast.error(res.message || "Failed to load video.");
      }
    };

    useEffect(() => {
      load();
      api.get<{ playlists: { id: string; title: string }[] }>("/api/videos/youtube/playlists").then((r) => {
        if (r.success && r.data?.playlists) setPlaylists(r.data.playlists);
      });
      api.get<{ channels: { id: string; title: string }[] }>("/api/videos/youtube/channels").then((r) => {
        if (r.success && r.data?.channels) {
          setChannels(r.data.channels);
          setChannelId((current) => current || r.data?.channels?.[0]?.id || "");
        }
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
    const res = await api.post<{ youtubeUrl?: string; youtubeVideoId?: string; mode?: string; source?: string; channelTitle?: string; playlistId?: string }>(
      `/api/videos/${id}/lessons/${language}/publish`,
      {
        source,
        voice: source === "dub" ? dubForLanguage?.voice || undefined : undefined,
        title,
        description,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        visibility,
        categoryId,
        playlistId: playlistId || undefined,
        channelId: channelId || undefined,
        thumbnailUrl: thumbnailUrl.trim() || undefined,
      },
    );
    setPublishing(false);
    if (res.success) {
      toast.success(res.message || (res.data?.mode === "updated" ? "Updated on YouTube." : "Published to YouTube."));
      setPublishedUrl(res.data?.youtubeUrl || null);
      await load();
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
                <Label htmlFor="publishSource">Video to publish</Label>
                <select
                  id="publishSource"
                  value={source}
                  onChange={(e) => setSource(e.target.value as "lesson" | "dub")}
                  className="h-9 w-full rounded-md border-2 border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                >
                  {dubForLanguage && (
                    <option value="dub">
                      Dubbed original — original footage + translated voice
                      {dubForLanguage.durationSeconds ? ` (${dubForLanguage.durationSeconds}s)` : ""}
                      {dubForLanguage.voice ? ` • ${dubForLanguage.voice}` : ""}
                    </option>
                  )}
                  {lessonForLanguage && (
                    <option value="lesson">
                      Study-journey lesson — new AI narration
                      {lessonForLanguage.durationSeconds ? ` (${lessonForLanguage.durationSeconds}s)` : ""}
                    </option>
                  )}
                </select>
                {!dubForLanguage && !lessonForLanguage && (
                  <p className="text-sm text-destructive">
                    Nothing to publish for this language yet. Dub the original video or generate a study-journey lesson first.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {source === "dub"
                    ? "The dubbed video keeps the original footage and timing; only the audio is translated."
                    : "The study-journey video is a new render with an AI-written narration and burned-in subtitles."}
                </p>
              </div>
              {existingPublish?.youtubeVideoId && (
                <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100">
                  <p className="font-semibold">This language is already published on YouTube.</p>
                  <p>Source: {existingPublish.source === "dub" ? "Dubbed original video" : "Study-journey lesson video"}</p>
                  <p>Mode: update (publish again to change title/description/thumbnail/settings)</p>
                  {existingPublish.youtubeChannelTitle && <p>Channel: {existingPublish.youtubeChannelTitle}</p>}
                  {existingPublish.youtubePlaylistId && <p>Playlist ID: {existingPublish.youtubePlaylistId}</p>}
                  {existingPublish.youtubeUrl && (
                    <a href={existingPublish.youtubeUrl} target="_blank" rel="noreferrer" className="underline">
                      Open on YouTube
                    </a>
                  )}
                </div>
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
              <div className="space-y-2">
                <Label>Thumbnail URL</Label>
                <Input value={thumbnailUrl} onChange={(e) => setThumbnailUrl(e.target.value)} />
                {thumbnailUrl && (
                  <img
                    src={thumbnailUrl}
                    alt="Generated thumbnail preview"
                    className="mt-2 w-full max-w-md rounded-md border"
                  />
                )}
              </div>
              <div className="space-y-2">
                <Label>YouTube channel</Label>
                <select
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                  className="w-full h-9 rounded-md border-2 border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                >
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
                {existingPublish?.youtubeChannelTitle && (
                  <p className="text-xs text-muted-foreground">
                    Last published channel: {existingPublish.youtubeChannelTitle}
                  </p>
                )}
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
              <div className="flex items-center gap-2">
                <Button onClick={publish} disabled={publishing || !ytConnected || (!dubForLanguage && !lessonForLanguage)}>
                  {publishing ? "Publishing…" : existingPublish?.youtubeVideoId ? "Update on YouTube" : "Publish to YouTube"}
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
  const voice = searchParams.get("voice") || "";
  return <PublishForm id={id} language={language} voice={voice} />;
}

export default function PublishPage() {
  return (
    <Suspense fallback={<div className="p-4">Loading…</div>}>
      <PublishPageClient />
    </Suspense>
  );
}
