"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
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

/** The languages the Automation Form lets the video be declared in. */
const VIDEO_LANGUAGE_OPTIONS = [
  { value: "es", label: "Spanish" },
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "ru", label: "Russian" },
  { value: "ar", label: "Arabic" },
  { value: "hi", label: "Hindi" },
  { value: "zh", label: "Chinese" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "tr", label: "Turkish" },
  { value: "nl", label: "Dutch" },
  { value: "pl", label: "Polish" },
];

type ThumbnailOptions = {
  title: string;
  language: string;
  courseImageUrl?: string | null;
  lessonNumber?: number | null;
};

/** The word "Lesson" in the language the lesson is published in. */
const LESSON_WORD: Record<string, string> = {
  en: "Lesson",
  es: "Lección",
  fr: "Leçon",
  de: "Lektion",
  it: "Lezione",
  pt: "Lição",
  ru: "Урок",
  ar: "الدرس",
  hi: "पाठ",
  tr: "Ders",
  nl: "Les",
  pl: "Lekcja",
};

/** The badge that shows the number of the lesson, written in its language. */
function lessonBadgeText(language: string, number: number) {
  const code = String(language || "en").toLowerCase().split("-")[0];
  // These languages put the number inside the word.
  if (code === "zh") return `第${number}课`;
  if (code === "ja") return `第${number}節`;
  if (code === "ko") return `${number}강`;
  const word = LESSON_WORD[code] || LESSON_WORD.en;
  return `${word} ${number}`;
}

/** Draws a rounded rectangle, with a fallback for older browsers. */
function fillRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, radius);
  } else {
    ctx.rect(x, y, width, height);
  }
  ctx.fill();
}

async function createCanvasThumbnailDataUrl({
  title,
  language,
  courseImageUrl,
  lessonNumber,
}: ThumbnailOptions): Promise<string> {
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

  const safeTitle = (title || "Lesson").slice(0, 140);
  const FONT = (size: number) => `bold ${size}px 'Segoe UI', 'Tahoma', sans-serif`;

  // The title takes two lines at most. A third line would push the badge
  // out of the panel, so a longer title is shrunk and then cut.
  const MAX_LINES = 2;
  let fontSize = 74;
  let lines: string[] = [];
  let cut = false;
  for (;;) {
    ctx.font = FONT(fontSize);
    const wrapped = wrapCanvasText(ctx, safeTitle, 1080);
    const tooWide = wrapped.some((line) => ctx.measureText(line).width > 1080);
    if (wrapped.length <= MAX_LINES && !tooWide) {
      lines = wrapped;
      break;
    }
    if (fontSize <= 38) {
      lines = wrapped.slice(0, MAX_LINES);
      cut = wrapped.length > MAX_LINES || tooWide;
      break;
    }
    fontSize -= 4;
  }
  if (cut && lines.length) {
    let last = lines[lines.length - 1].replace(/[\s.\-]+$/, "");
    while (last.length > 4 && ctx.measureText(`${last}…`).width > 1080) {
      last = last.slice(0, -2).trimEnd();
    }
    lines[lines.length - 1] = `${last}…`;
  }
  ctx.font = FONT(fontSize);

  const lineHeight = Math.round(fontSize * 1.16);
  const titleCenter = 588;
  const startY = titleCenter - ((lines.length - 1) * lineHeight) / 2;
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

  // The lesson number, written in the language of the lesson. Without a
  // number the badge falls back to the course label.
  const badgeCenter = 481;
  if (lessonNumber) {
    const badgeText = lessonBadgeText(language, lessonNumber);
    ctx.font = "bold 34px 'Segoe UI', 'Tahoma', sans-serif";
    const badgeWidth = ctx.measureText(badgeText).width + 60;
    const badgeHeight = 58;
    ctx.fillStyle = "#ff8a00";
    fillRoundedRect(
      ctx,
      (canvas.width - badgeWidth) / 2,
      badgeCenter - badgeHeight / 2,
      badgeWidth,
      badgeHeight,
      badgeHeight / 2,
    );
    ctx.fillStyle = "#1b1206";
    ctx.fillText(badgeText, canvas.width / 2, badgeCenter + 2);
  } else {
    ctx.font = "bold 30px 'Segoe UI', 'Tahoma', sans-serif";
    ctx.fillStyle = "#ff8a00";
    ctx.fillText(
      isArabic ? "دورة تعليمية" : hasImage ? "Course lesson" : "Course lesson",
      canvas.width / 2,
      badgeCenter,
    );
  }

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
  youtubeMadeForKids?: boolean | null;
  youtubeSelfDeclaredAiContent?: boolean | null;
  youtubePaidPromotion?: boolean | null;
  youtubeAllowEmbedding?: boolean | null;
  youtubePublishToSubs?: boolean | null;
  youtubeShortsRemixing?: string | null;
  youtubeAutomaticChapters?: boolean | null;
  youtubeVideoLanguage?: string | null;
  youtubeTitleDescriptionLanguage?: string | null;
  youtubeRecordingDate?: string | Date | null;
  youtubeLocation?: string | null;
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

type YouTubeLesson = {
  videoId: string;
  title: string;
  order: number;
  lessonNumber: number | null;
  language: string;
  published: boolean;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
  youtubeTitle: string | null;
  publishedAt: string | null;
  inPlaylist: boolean;
  playlistPosition: number | null;
  duplicates: { videoId: string; title: string; publishedAt: string | null }[];
};

type VideoYouTubeCourse = {
  course: {
    id: string;
    title: string;
    language: string;
    channelTitle?: string | null;
    playlistId: string | null;
    playlistUrl: string | null;
  };
  lesson: YouTubeLesson | null;
  dubs: {
    language: string;
    voice: string | null;
    createdAt: string | null;
    published: boolean;
    youtubeUrl: string | null;
  }[];
  error?: string;
};

type VideoYouTubeState = { videoId: string; courses: VideoYouTubeCourse[] };

function PublishForm({ id, language, voice: voiceParam }: { id: string; language: string; voice?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [video, setVideo] = useState<VideoDetail | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
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
  const [courseId, setCourseId] = useState("");
  const [youtubeState, setYoutubeState] = useState<VideoYouTubeState | null>(null);
  const [loadingYoutube, setLoadingYoutube] = useState(false);
  const [lessonNumber, setLessonNumber] = useState<number | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  // The YouTube Automation Form checklist fields. They decide how the video
  // sits on the channel, so they are part of the publish payload.
  const [madeForKids, setMadeForKids] = useState(false);
  const [selfDeclaredAiContent, setSelfDeclaredAiContent] = useState(false);
  const [paidPromotion, setPaidPromotion] = useState(false);
  const [allowEmbedding, setAllowEmbedding] = useState(true);
  const [publishToSubs, setPublishToSubs] = useState(true);
  const [shortsRemixing, setShortsRemixing] = useState<"allow" | "disallow">("allow");
  const [automaticChapters, setAutomaticChapters] = useState(true);
  const [videoLanguage, setVideoLanguage] = useState("es");
  const [titleDescriptionLanguage, setTitleDescriptionLanguage] = useState("Spanish");
  const [recordingDate, setRecordingDate] = useState("");
  const [location, setLocation] = useState("");
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

  // The YouTube truth for this lesson, read from the channel uploads.
  const youtubeMatch =
    (youtubeState?.courses || []).find(
      (entry) =>
        entry.lesson &&
        String(entry.lesson.language).split("-")[0] ===
          String(language).split("-")[0],
    ) ||
    (youtubeState?.courses || [])[0] ||
    null;
  const youtubeLesson = youtubeMatch?.lesson || null;
  const currentVoicePublished = Boolean(
    youtubeMatch?.dubs.find(
      (dub) =>
        String(dub.voice || "") === String(dubForLanguage?.voice || "") &&
        dub.published,
    ),
  );

  const load = async () => {
    const res = await api.get<{ video: VideoDetail; metadata?: VideoDetail["aiMetadata"]; language?: string }>(
      `/api/videos/${id}/publish-prefill?language=${encodeURIComponent(language)}`,
    );

    // The course this video belongs to. Its image becomes the background of
    // the generated YouTube thumbnail.
    let courseImage = "";
    let courseLessonNumber: number | null = null;
    try {
      const courseRes = await api.get<{
        items: {
          _id: string;
          title: string;
          thumbnailUrl?: string | null;
          videos?: { video: { _id: string } | null; order?: number | null }[];
        }[];
      }>("/api/courses");
      if (courseRes.success) {
        const course = (courseRes.data?.items || []).find((item) =>
          (item.videos || []).some((entry) => entry.video?._id === id),
        );
        if (course) {
          setCourseTitle(course.title);
          setCourseId(course._id);
          if (course.thumbnailUrl) {
            courseImage = course.thumbnailUrl;
            setCourseImageUrl(course.thumbnailUrl);
          }
          // The number of the lesson is its position in the course.
          const ordered = [...(course.videos || [])].sort(
            (a, b) => (a.order ?? 0) - (b.order ?? 0),
          );
          const position = ordered.findIndex(
            (entry) => entry.video?._id === id,
          );
          if (position >= 0) {
            courseLessonNumber = position + 1;
            setLessonNumber(courseLessonNumber);
          }
        }
      }
    } catch {
      // The course lookup must never stop the publish form.
    }

    // The published status and link come from YouTube itself, so a video that
    // is already live is never shown as missing.
    try {
      setLoadingYoutube(true);
      const yt = await api.get<VideoYouTubeState>(`/api/videos/${id}/youtube`);
      if (yt.success && yt.data) setYoutubeState(yt.data);
    } catch {
      setYoutubeState(null);
    } finally {
      setLoadingYoutube(false);
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
        const body = [opening, pointLines].filter(Boolean).join("\n");
        const resourceLinks = (v.attachments || [])
          .filter((a) => a?.url)
          .map((a) => `- ${a?.name || a.url}: ${a.url}`)
          .join("\n");
        const questionsBlock = (meta.openQuestions || []).length
          ? `❓ Questions:\n${(meta.openQuestions || [])
              .map((q, i) => `${i + 1}. ${String(q).trim()}`)
              .join("\n")}`
          : "";
        const shareCta = (language || "").toLowerCase().startsWith("ar")
          ? "👍 إذا أعجبك الفيديو، شاركه مع أصدقائك وادعم القناة بالاشتراك — نشركم هو دعم لنا!"
          : "👍 If you found this helpful, please like, share and subscribe to support the channel!";
        const composedDescription = [
          body,
          chapterLines ? `-----------------------------------------------------------------------------------------------------\n${chapterLines}` : "",
          resourceLinks ? `🔗 Resources, commands, and links:\n${resourceLinks}` : "",
          questionsBlock,
          `📣 ${shareCta}`,
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
        const titleNumber = lessonNumberFrom(v.title) || lessonNumberFrom(v.originalFilename);
        // The position inside the course wins, because it is the real order
        // of the lessons. The number in the file name is only a fallback.
        const lessonNumberValue =
          courseLessonNumber ?? (titleNumber ? Number(titleNumber) : null);
        const titledWithNumber =
          lessonNumberValue && !String(preferredTitle).trim().match(/^\d+/)
            ? `${lessonNumberValue}. ${preferredTitle}`
            : preferredTitle;
        setTitle(titledWithNumber);
        setDescription(existingPublishLesson?.youtubeDescription || composedDescription);
        setTags(((existingPublishLesson?.youtubeTags && existingPublishLesson.youtubeTags.length ? existingPublishLesson.youtubeTags : (meta.tags || [])) as string[]).join(", "));
        setQuestions((meta.openQuestions || []).map((q) => String(q).trim()).filter(Boolean));
        setVisibility(existingPublishLesson?.youtubeVisibility || v.youtubeVisibility || "private");
        setCategoryId(existingPublishLesson?.youtubeCategoryId || v.youtubeCategoryId || "27");
        setPlaylistId(existingPublishLesson?.youtubePlaylistId || "");
        setThumbnailUrl(existingPublishLesson?.thumbnailUrl || v.thumbnailUrl || "");
        setMadeForKids(Boolean(existingPublishLesson?.youtubeMadeForKids ?? false));
        setSelfDeclaredAiContent(Boolean(existingPublishLesson?.youtubeSelfDeclaredAiContent ?? false));
        setPaidPromotion(Boolean(existingPublishLesson?.youtubePaidPromotion ?? false));
        setAllowEmbedding(existingPublishLesson?.youtubeAllowEmbedding ?? true);
        setPublishToSubs(existingPublishLesson?.youtubePublishToSubs ?? true);
        setShortsRemixing(existingPublishLesson?.youtubeShortsRemixing === "disallow" ? "disallow" : "allow");
        setAutomaticChapters(existingPublishLesson?.youtubeAutomaticChapters ?? true);
        setVideoLanguage(existingPublishLesson?.youtubeVideoLanguage || language);
        setTitleDescriptionLanguage(
          existingPublishLesson?.youtubeTitleDescriptionLanguage ||
            (language.toLowerCase().startsWith("es") ? "Spanish" : language.toUpperCase()),
        );
        setRecordingDate(
          existingPublishLesson?.youtubeRecordingDate
            ? String(existingPublishLesson.youtubeRecordingDate).slice(0, 10)
            : new Date().toISOString().slice(0, 10),
        );
        setLocation(existingPublishLesson?.youtubeLocation || "");
        if (existingPublishLesson?.youtubeChannelId) setChannelId(existingPublishLesson.youtubeChannelId);
        if (!v.thumbnailUrl && !existingPublishLesson?.thumbnailUrl) {
          const titleText = meta.titles?.[0] || v.title || "Lesson";
          createCanvasThumbnailDataUrl({
            title: titleText,
            language,
            courseImageUrl: courseImage,
            lessonNumber: lessonNumberValue,
          }).then(
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

  /**
   * Rebuilds the thumbnail by hand: the course image as the background, the
   * title of the form on two lines at most, and the number of the lesson in
   * the language of the lesson.
   */
  const regenerateThumbnail = async () => {
    setRegenerating(true);
    try {
      // The number has its own badge, so it must not be repeated in the
      // title written on the image.
      const titleForImage = String(title || "")
        .trim()
        .replace(/^\d+\s*[.\-–:)]\s*/, "");
      const dataUrl = await createCanvasThumbnailDataUrl({
        title: titleForImage,
        language,
        courseImageUrl: courseImageUrl,
        lessonNumber,
      });
      if (!dataUrl) {
        toast.error("The thumbnail could not be drawn.");
        return;
      }
      const res = await api.post<{ thumbnailUrl: string }>(
        `/api/videos/${id}/thumbnail`,
        { thumbnailDataUrl: dataUrl },
      );
      if (res.success && res.data?.thumbnailUrl) {
        setThumbnailUrl(res.data.thumbnailUrl);
        toast.success("Thumbnail regenerated.");
      } else {
        toast.error(res.message || "The thumbnail could not be saved.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The thumbnail could not be saved.",
      );
    } finally {
      setRegenerating(false);
    }
  };

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
        madeForKids,
        selfDeclaredAiContent,
        paidPromotion,
        allowEmbedding,
        publishToSubs,
        shortsRemixing,
        automaticChapters,
        videoLanguage,
        titleDescriptionLanguage,
        recordingDate,
        location,
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
          <div className="flex items-center gap-2">
            {courseId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/courses/${courseId}`)}
              >
                Open course
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => router.push(`/videos/${id}`)}>
              Back to video
            </Button>
          </div>
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
              {youtubeLesson && (
                <div
                  className={`rounded-md border p-3 text-sm ${
                    youtubeLesson.published
                      ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100"
                      : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">
                      {youtubeLesson.published
                        ? "Found on YouTube"
                        : "Not found on YouTube for this language"}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => load()}
                      disabled={loadingYoutube}
                    >
                      {loadingYoutube ? (
                        <Loader2 className="mr-1 size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-1 size-3.5" />
                      )}
                      Refresh
                    </Button>
                  </div>
                  {youtubeLesson.published ? (
                    <div className="mt-1 space-y-1">
                      <p className="text-xs">{youtubeLesson.youtubeTitle}</p>
                      <p className="text-xs">
                        Uploaded{" "}
                        {youtubeLesson.publishedAt
                          ? new Date(youtubeLesson.publishedAt).toLocaleString()
                          : "unknown"}{" "}
                        ·{" "}
                        {youtubeLesson.inPlaylist
                          ? `in the playlist at position ${
                              (youtubeLesson.playlistPosition ?? 0) + 1
                            }`
                          : "not in the course playlist"}
                      </p>
                      {youtubeLesson.duplicates.length > 0 && (
                        <p className="text-xs">
                          {youtubeLesson.duplicates.length} older copy
                          {youtubeLesson.duplicates.length === 1 ? "" : "ies"}{" "}
                          will be removed when this is published again.
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        <a
                          href={youtubeLesson.youtubeUrl || "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          Open on YouTube
                        </a>
                        {youtubeMatch?.course.playlistUrl && (
                          <a
                            href={youtubeMatch.course.playlistUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                          >
                            Open playlist
                          </a>
                        )}
                      </div>
                      {!currentVoicePublished && dubForLanguage?.voice && (
                        <p className="text-xs">
                          The voice on YouTube is not{" "}
                          {dubForLanguage.voice}. Publishing now uploads this
                          voice as a new video and removes the older copy.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-1 text-xs">
                      Publishing now uploads this lesson and adds it to the
                      course playlist at its lesson position.
                    </p>
                  )}
                </div>
              )}
              {!youtubeLesson && existingPublish?.youtubeVideoId && (
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
                    {courseId && (
                      <Link
                        href={`/courses/${courseId}`}
                        className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <ExternalLink className="size-3" />
                        Open the course
                      </Link>
                    )}
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
              {questions.length > 0 && (
                <div className="space-y-2 rounded-md border bg-muted/40 p-3">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    ❓ Questions (will be added as comments on YouTube)
                  </Label>
                  <ol className="list-decimal space-y-1 pl-5 text-sm">
                    {questions.map((q, i) => (
                      <li key={i} className="leading-relaxed">
                        {q}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <div className="space-y-2">
                <Label>Tags (comma separated)</Label>
                <Input value={tags} onChange={(e) => setTags(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Audience &amp; playlists</Label>
                <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={madeForKids}
                    onChange={(e) => setMadeForKids(e.target.checked)}
                    className="h-4 w-4 accent-amber-500"
                  />
                  <span>Made For Kids</span>
                </label>
                <p className="text-xs text-muted-foreground">
                  The lesson is for a general education audience, so it stays off.
                </p>
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
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={regenerateThumbnail}
                    disabled={regenerating}
                  >
                    {regenerating ? "Regenerating…" : "Regenerate thumbnail"}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {lessonNumber
                      ? `${lessonBadgeText(language, lessonNumber)} — the course image with the lesson title.`
                      : "The course image with the lesson title."}
                  </span>
                </div>
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
              <div className="space-y-2">
                <Label>Language &amp; metadata</Label>
                <div className="space-y-3 rounded-md border p-3">
                  <div className="space-y-1">
                    <Label htmlFor="videoLanguage" className="text-xs">Video language</Label>
                    <select
                      id="videoLanguage"
                      value={videoLanguage}
                      onChange={(e) => setVideoLanguage(e.target.value)}
                      className="w-full h-9 rounded-md border-2 border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    >
                      {VIDEO_LANGUAGE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="titleDescriptionLanguage" className="text-xs">Title &amp; description language</Label>
                    <Input
                      id="titleDescriptionLanguage"
                      value={titleDescriptionLanguage}
                      onChange={(e) => setTitleDescriptionLanguage(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label htmlFor="recordingDate" className="text-xs">Recording date</Label>
                      <Input
                        id="recordingDate"
                        type="date"
                        value={recordingDate}
                        onChange={(e) => setRecordingDate(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="location" className="text-xs">Location</Label>
                      <Input
                        id="location"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="Optional"
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Advanced settings</Label>
                <div className="space-y-3 rounded-md border p-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selfDeclaredAiContent}
                      onChange={(e) => setSelfDeclaredAiContent(e.target.checked)}
                      className="h-4 w-4 accent-amber-500"
                    />
                    <span>Self-declared AI content</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={paidPromotion}
                      onChange={(e) => setPaidPromotion(e.target.checked)}
                      className="h-4 w-4 accent-amber-500"
                    />
                    <span>Paid promotion</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={allowEmbedding}
                      onChange={(e) => setAllowEmbedding(e.target.checked)}
                      className="h-4 w-4 accent-amber-500"
                    />
                    <span>Allow embedding</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={publishToSubs}
                      onChange={(e) => setPublishToSubs(e.target.checked)}
                      className="h-4 w-4 accent-amber-500"
                    />
                    <span>Publish to subscriptions feed</span>
                  </label>
                  <div className="space-y-1">
                    <Label htmlFor="shortsRemixing" className="text-xs">Shorts remixing</Label>
                    <select
                      id="shortsRemixing"
                      value={shortsRemixing}
                      onChange={(e) => setShortsRemixing(e.target.value as "allow" | "disallow")}
                      className="w-full h-9 rounded-md border-2 border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    >
                      <option value="allow">Allow Video and Audio Remixing</option>
                      <option value="disallow">Don&apos;t allow</option>
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={automaticChapters}
                      onChange={(e) => setAutomaticChapters(e.target.checked)}
                      className="h-4 w-4 accent-amber-500"
                    />
                    <span>Automatic chapters</span>
                  </label>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={publish} disabled={publishing || !ytConnected || (!dubForLanguage && !lessonForLanguage)}>
                  {publishing ? "Publishing…" : currentVoicePublished ? "Update on YouTube" : youtubeLesson?.published ? "Replace the YouTube version" : "Publish to YouTube"}
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
