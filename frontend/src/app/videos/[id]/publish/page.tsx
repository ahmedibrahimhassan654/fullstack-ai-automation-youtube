"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AuthGuard } from "@/components/auth-guard";
import { AppShell } from "@/components/app-shell";
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
  // The split must be on real whitespace: a title that is never split into
  // words can not be wrapped, and it ran off both edges of the thumbnail.
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
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

/** Loads an image so it can be drawn on the canvas. */
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/**
 * Draws the course image as the background of the thumbnail, falling back to
 * the plain gradient when there is no image.
 */
async function drawThumbnailBackground(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  courseImageUrl?: string | null,
) {
  if (courseImageUrl) {
    const image = await loadImage(courseImageUrl);
    if (image) {
      // Cover fit: fill the canvas and crop the overflow.
      const scale = Math.max(
        canvas.width / image.width,
        canvas.height / image.height,
      );
      const width = image.width * scale;
      const height = image.height * scale;
      ctx.drawImage(
        image,
        (canvas.width - width) / 2,
        (canvas.height - height) / 2,
        width,
        height,
      );

      // Darken it so the title stays readable on top of the picture.
      const shade = ctx.createLinearGradient(0, 0, 0, canvas.height);
      shade.addColorStop(0, "rgba(4, 10, 28, 0.45)");
      shade.addColorStop(0.5, "rgba(4, 10, 28, 0.35)");
      shade.addColorStop(1, "rgba(4, 10, 28, 0.75)");
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return true;
    }
  }

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#081229");
  gradient.addColorStop(0.55, "#102a5c");
  gradient.addColorStop(1, "#1f4f99");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return false;
}

async function createCanvasThumbnailDataUrl(
  title: string,
  language: string,
  courseImageUrl?: string | null,
): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const isArabic = language.toLowerCase().startsWith("ar");

  const hasImage = await drawThumbnailBackground(canvas, ctx, courseImageUrl);

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

  const safeTitle = (title || "Lesson").slice(0, 90);
  const FONT = (size: number) =>
    `bold ${size}px 'Segoe UI', 'Tahoma', sans-serif`;

  // Shrink the title until the widest line fits, so it never runs off the
  // edges of the thumbnail.
  let fontSize = 74;
  ctx.font = FONT(fontSize);
  let lines = wrapCanvasText(ctx, safeTitle, 1080).slice(0, 3);
  while (
    lines.some((line) => ctx.measureText(line).width > 1080) &&
    fontSize > 38
  ) {
    fontSize -= 4;
    ctx.font = FONT(fontSize);
    lines = wrapCanvasText(ctx, safeTitle, 1080).slice(0, 3);
  }
  ctx.font = FONT(fontSize);

  const lineHeight = Math.round(fontSize * 1.16);
  const startY = 500 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => {
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillText(line, canvas.width / 2 + 4, startY + index * lineHeight + 4);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(line, canvas.width / 2, startY + index * lineHeight);
  });

  // Accent underline.
  ctx.fillStyle = "#ff8a00";
  ctx.fillRect(
    canvas.width / 2 - 180,
    startY + lines.length * lineHeight - 18,
    360,
    8,
  );

  // Small subtitle badge.
  ctx.font = "bold 30px 'Segoe UI', 'Tahoma', sans-serif";
  ctx.fillStyle = "#ff8a00";
  ctx.fillText(
    isArabic ? "دورة تعليمية" : hasImage ? "Course lesson" : "Course lesson",
    canvas.width / 2,
    405,
  );

  return canvas.toDataURL("image/png");
}

type LessonPublishInfo = {
  language?: string;
  source?: "lesson" | "dub";
  url?: string | null;
  durationSeconds?: number | null;
  voice?: string | null;
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
  const [channels, setChannels] = useState<{ id: string; title: string; language?: string | null }[]>([]);
  const [channelId, setChannelId] = useState("");
  const [ytConnected, setYtConnected] = useState(false);
  const [ytChannelTitle, setYtChannelTitle] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [source, setSource] = useState<"lesson" | "dub">("lesson");
  const [courseImageUrl, setCourseImageUrl] = useState("");
  const [courseTitle, setCourseTitle] = useState("");
  const selectedChannel = channels.find((c) => c.id === channelId) || null;
  const selectedChannelLanguage = (selectedChannel?.language || "")
    .toLowerCase()
    .split("-")[0];
  // A video published in one language belongs on the channel of that
  // language, so a mismatch is worth pointing out.
  const channelLanguageMismatch =
    Boolean(selectedChannel) &&
    Boolean(selectedChannelLanguage) &&
    selectedChannelLanguage !== language.toLowerCase().split("-")[0];
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

    // The course this video belongs to. Its image becomes the background of
    // the generated YouTube thumbnail.
    let courseImage = "";
    try {
      const courseRes = await api.get<{
        items: {
          _id: string;
          title: string;
          thumbnailUrl?: string | null;
          videos?: { video: { _id: string } | null }[];
        }[];
      }>("/api/courses");
      if (courseRes.success) {
        const course = (courseRes.data?.items || []).find((item) =>
          (item.videos || []).some((entry) => entry.video?._id === id),
        );
        if (course) {
          setCourseTitle(course.title);
          if (course.thumbnailUrl) {
            courseImage = course.thumbnailUrl;
            setCourseImageUrl(course.thumbnailUrl);
          }
        }
      }
    } catch {
      // The course lookup must never stop the publish form.
    }

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
          createCanvasThumbnailDataUrl(titleText, language, courseImage).then(
            (dataUrl) => {
              if (!dataUrl) return;
              api
                .post<{ thumbnailUrl: string }>(`/api/videos/${id}/thumbnail`, {
                  thumbnailDataUrl: dataUrl,
                })
                .then((r) => {
                  if (r.success && r.data?.thumbnailUrl)
                    setThumbnailUrl(r.data.thumbnailUrl);
                });
            },
          );
        }
        setCategoryId(v.youtubeCategoryId || "27");

      } else {
        toast.error(res.message || "Failed to load video.");
      }
    };

    useEffect(() => {
      load();
      api.get<{ channels: { id: string; title: string; language?: string | null }[] }>("/api/videos/youtube/channels").then((r) => {
        if (r.success && r.data?.channels) {
          const list = r.data.channels;
          setChannels(list);
          setChannelId((current) => {
            if (current && list.some((c) => c.id === current)) return current;
            // The video is published in one language, so the channel that
            // speaks that language is the right default.
            const wanted = language.toLowerCase().split("-")[0];
            const match = list.find((c) => (c.language || "").toLowerCase().split("-")[0] === wanted);
            return match?.id || list[0]?.id || "";
          });
        }
      });
      api.get<{ connected?: boolean; channelTitle?: string | null }>("/api/auth/youtube/status").then((r) => {
        if (r.success) {
          setYtConnected(Boolean(r.data?.connected));
          setYtChannelTitle(r.data?.channelTitle || "");
        }
      });
  }, [id, language, toast]);

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
      <AppShell
        title="Prepare YouTube Publish"
        description="Review the title, description and thumbnail before publishing"
        contentClassName="max-w-3xl"
        actions={
          <Button variant="outline" size="sm" onClick={() => router.push(`/videos/${id}`)}>
            Back to video
          </Button>
        }
      >
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
              {courseTitle && (
                <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
                  {courseImageUrl ? (
                    <img
                      src={courseImageUrl}
                      alt=""
                      className="h-16 w-28 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <span className="flex h-16 w-28 shrink-0 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
                      No image
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{courseTitle}</p>
                    <p className="text-xs text-muted-foreground">
                      This video is a lesson of this course.
                      {courseImageUrl
                        ? " Its image is the background of the thumbnail."
                        : " Add an image to the course to use it as the thumbnail background."}
                    </p>
                  </div>
                </div>
              )}
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
                  onChange={(e) => {
                    setChannelId(e.target.value);
                    // The playlist belongs to the channel, so the old one
                    // cannot stay selected.
                    setPlaylistId("");
                    setPlaylists([]);
                  }}
                  className="w-full h-9 rounded-md border-2 border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                >
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                      {c.language ? ` — ${c.language}` : ""}
                    </option>
                  ))}
                </select>
                {channelLanguageMismatch && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    This video is in {language}, but the selected channel publishes in{" "}
                    {selectedChannel?.language}. Pick the channel of {language}.
                  </p>
                )}
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
                <Input
                  value={
                    !ytConnected
                      ? "Not connected"
                      : selectedChannel
                        ? `${selectedChannel.title}${selectedChannel.language ? ` — ${selectedChannel.language}` : ""}`
                        : ytChannelTitle || "Connected channel"
                  }
                  readOnly
                />
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
      </AppShell>
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
