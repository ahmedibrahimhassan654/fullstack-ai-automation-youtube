"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  ExternalLink,
  ImageIcon,
  Languages,
  ListVideo,
  Loader2,
  PlayCircle,
  Plus,
  Radio,
  RefreshCw,
  Trash2,
  Tv,
} from "lucide-react";
import { AuthGuard } from "@/components/auth-guard";
import { AppShell } from "@/components/app-shell";
import { useToast } from "@/components/toast-provider";
import { api } from "@/lib/api";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { LANGUAGES, languageLabel } from "@/lib/languages";
import { cn } from "@/lib/utils";

type CourseVideo = {
  order: number;
  videoId?: string | null;
  language?: string | null;
  youtubeVideoId?: string | null;
  youtubeUrl?: string | null;
  publishedAt?: string | null;
  video: {
    _id: string;
    title: string;
    status: string;
    durationSeconds?: number;
    dubs?: { language: string; url?: string }[];
    lessonVideos?: { language: string; source?: string; url?: string }[];
  } | null;
};

type Course = {
  _id: string;
  title: string;
  description?: string;
  language?: string;
  channelId?: string | null;
  channelTitle?: string | null;
  channelLanguage?: string | null;
  playlistId?: string | null;
  playlistTitle?: string | null;
  thumbnailUrl?: string | null;
  status?: string;
  createdAt?: string;
  videos: CourseVideo[];
  publishing?: {
    status: string;
    progress: number;
    publishedCount: number;
    total: number;
    error?: string | null;
  };
};

type VideoRow = {
  _id: string;
  title: string;
  status: string;
  dubs?: { language: string; voice?: string; url?: string }[];
  lessonVideos?: { language: string; source?: string; youtubeVideoId?: string | null; youtubeUrl?: string | null }[];
  translations?: { language: string }[];
};

type CourseSummary = {
  _id: string;
  title: string;
  language?: string;
  videos?: { video?: { _id: string } | string | null; videoId?: string | null }[];
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
  playlistItemDuplicates: { playlistItemId: string; videoId: string; position: number }[];
};

type YouTubeState = {
  course: {
    id: string;
    title: string;
    channelTitle?: string | null;
    playlistId: string | null;
    playlistUrl: string | null;
  };
  lessons: YouTubeLesson[];
  unmatchedPlaylistItems: { videoId: string; title: string; position: number }[];
  summary: {
    lessons: number;
    published: number;
    inPlaylist: number;
    duplicates: number;
  };
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return "unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown date" : date.toLocaleString();
};

const fieldClass =
  "h-9 w-full rounded-md border-2 border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";

export default function CourseDetailClient({
  id,
  initialCourse = null,
}: {
  id: string;
  initialCourse?: Course | null;
}) {
  const router = useRouter();
  const toast = useToast();

  const [course, setCourse] = useState<Course | null>(initialCourse);
  const [allVideos, setAllVideos] = useState<VideoRow[]>([]);
  const [allCourses, setAllCourses] = useState<CourseSummary[]>([]);
  const [lessonCourseFilter, setLessonCourseFilter] = useState<string>("all");
  const [title, setTitle] = useState(initialCourse?.title || "");
  const [description, setDescription] = useState(initialCourse?.description || "");
  const [language, setLanguage] = useState(initialCourse?.language || "en");
  const [loading, setLoading] = useState(!initialCourse);
  const [saving, setSaving] = useState(false);
  const [dubbing, setDubbing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dubProgress, setDubProgress] = useState<
    Record<string, { status: string; progress: number; error?: string | null }>
  >({});
  const [newLessonLanguage, setNewLessonLanguage] = useState("en");
  type StagedLesson = {
    key: string;
    video: File;
    subtitle: File | null;
    baseName: string;
    status: "pending" | "uploading" | "subtitle" | "processing" | "adding" | "done" | "error";
    message?: string;
    videoId?: string;
  };
  const [stagedLessons, setStagedLessons] = useState<StagedLesson[]>([]);
  const [stagedSubtitlePool, setStagedSubtitlePool] = useState<File[]>([]);
  const [stagingUploading, setStagingUploading] = useState(false);
  const [stagingOverall, setStagingOverall] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  const [youtube, setYoutube] = useState<YouTubeState | null>(null);
  const [loadingYoutube, setLoadingYoutube] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoFilesInputRef = useRef<HTMLInputElement>(null);
  const subtitleFilesInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const loadCourses = useCallback(async () => {
    const res = await api.get<{ items: CourseSummary[] }>("/api/courses");
    if (res.success) setAllCourses(res.data?.items || []);
  }, []);

  const load = useCallback(async () => {
    const [res] = await Promise.all([
      api.get<{ course: Course }>(`/api/courses/${id}`),
      loadCourses(),
    ]);
    if (res.success && res.data?.course) {
      const value = res.data.course;
      setCourse(value);
      setTitle(value.title || "");
      setDescription(value.description || "");
      setLanguage(value.language || "en");
    } else {
      toast.error(res.message || "Failed to load the course.");
    }
    setLoading(false);
  }, [id, toast, loadCourses]);

  useEffect(() => {
    // When the server already provided the course (SSR), skip the initial
    // fetch and only load the supplementary video list.
    if (!initialCourse) load();
    else void loadCourses();
    api
      .get<{ items: VideoRow[] }>("/api/videos?limit=100")
      .then((res) => {
        if (res.success) setAllVideos(res.data?.items || []);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, initialCourse, loadCourses]);

  // The real YouTube state is read separately: it is the source of truth for
  // the published status and links shown on this page.
  const loadYouTube = useCallback(async () => {
    setLoadingYoutube(true);
    const res = await api.get<{ youtube: YouTubeState }>(
      `/api/courses/${id}/youtube`,
    );
    if (res.success && res.data?.youtube) {
      setYoutube(res.data.youtube);
    }
    setLoadingYoutube(false);
  }, [id]);

  useEffect(() => {
    loadYouTube();
  }, [loadYouTube]);

  // Follow the publish run while it is working.
  useEffect(() => {
    if (course?.publishing?.status !== "processing") return;
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, [course?.publishing?.status, load]);

  const hasVersion = (entry: CourseVideo, lang: string) =>
    Boolean(
      entry.video?.dubs?.some((dub) => dub.language === lang && dub.url) ||
        entry.video?.lessonVideos?.some(
          (lesson) =>
            lesson.language === lang &&
            (lesson.source || "lesson") === "lesson" &&
            lesson.url,
        ),
    );

  const missing = (course?.videos || []).filter(
    (entry) => entry.video && !hasVersion(entry, language),
  );

  const saveDetails = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const res = await api.patch(`/api/courses/${id}`, {
      title: title.trim(),
      description: description.trim(),
      language,
    });
    if (res.success) {
      toast.success(res.message || "Course updated.");
      await load();
    } else {
      toast.error(res.message || "Failed to update the course.");
    }
    setSaving(false);
  };

  /** Dubs every lesson that has no version in the course language yet, one by one. */
  const generateMissingDubs = async () => {
    const toDub = (course?.videos || []).filter(
      (entry) => entry.video && !hasVersion(entry, language),
    );
    if (!toDub.length) {
      toast.success("Every lesson already has a version in this language.");
      return;
    }

    setDubbing(true);
    setDubProgress({});

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    let done = 0;
    let failed = 0;

    for (const entry of toDub) {
      const videoId = String(entry.video?._id || "");
      if (!videoId) {
        failed += 1;
        continue;
      }

      setDubProgress((prev) => ({
        ...prev,
        [videoId]: { status: "processing", progress: 0 },
      }));

      const startRes = await api.post<{ video?: { dubbing?: { status?: string; progress?: number; error?: string | null } } }>(
        `/api/videos/${videoId}/dub`,
        { language },
      );

      if (!startRes.success) {
        failed += 1;
        setDubProgress((prev) => ({
          ...prev,
          [videoId]: {
            status: "failed",
            progress: 0,
            error: startRes.message || "Failed to start",
          },
        }));
        continue;
      }

      // Wait for this dub to finish before starting the next one.
      for (;;) {
        await sleep(4000);
        const statusRes = await api.get<{
          video?: {
            dubbing?: { status?: string; progress?: number; error?: string | null; language?: string | null };
            dubs?: { language?: string; url?: string }[];
          };
        }>(`/api/videos/${videoId}`);

        const v = statusRes.data?.video;
        const dubbingState = v?.dubbing;
        const progress =
          typeof dubbingState?.progress === "number" ? dubbingState.progress : 0;
        const status = String(dubbingState?.status || "");
        const hasDub = (v?.dubs || []).some(
          (d) => d.language === language && d.url,
        );

        if (status === "completed" || (status !== "processing" && hasDub)) {
          done += 1;
          setDubProgress((prev) => ({
            ...prev,
            [videoId]: { status: "completed", progress: 100 },
          }));
          break;
        }

        if (status === "failed") {
          failed += 1;
          setDubProgress((prev) => ({
            ...prev,
            [videoId]: {
              status: "failed",
              progress,
              error: dubbingState?.error || "Dubbing failed",
            },
          }));
          break;
        }

        if (!statusRes.success) {
          // Transient fetch issue: keep waiting/polling.
          setDubProgress((prev) => ({
            ...prev,
            [videoId]: {
              status: prev[videoId]?.status || "processing",
              progress: prev[videoId]?.progress ?? 0,
              error: statusRes.message || prev[videoId]?.error || null,
            },
          }));
          continue;
        }

        setDubProgress((prev) => ({
          ...prev,
          [videoId]: {
            status: status || "processing",
            progress,
            error: dubbingState?.error ?? null,
          },
        }));
      }
    }

    setDubbing(false);
    toast.success(
      failed === 0
        ? `Finished ${done} dub${done === 1 ? "" : "s"}.`
        : `Finished ${done} of ${toDub.length} dubs (${failed} failed).`,
    );
    await load();
    setTimeout(() => setDubProgress({}), 4000);
  };

  const publishCourse = async () => {
    const res = await api.post(`/api/courses/${id}/publish`);
    if (res.success) {
      toast.success(res.message || "Publishing started.");
      await load();
      await loadYouTube();
    } else {
      toast.error(res.message || "Failed to publish the course.");
    }
  };

  /**
   * Writes the YouTube truth into the database. With `deleteDuplicates` the
   * older copies of every lesson are removed from the channel and the
   * playlist is put back in lesson order.
   */
  const syncYouTube = async (deleteDuplicates: boolean) => {
    if (
      deleteDuplicates &&
      !window.confirm(
        "Remove the older copies of the lessons from YouTube and reorder the playlist?",
      )
    ) {
      return;
    }
    setSyncing(true);
    const res = await api.post<{
      state: YouTubeState;
      actions: {
        updated: string[];
        deleted: string[];
        playlistAdded: string[];
        reordered: string[];
        warnings: string[];
      };
    }>(`/api/courses/${id}/youtube/sync`, {
      deleteDuplicates,
      reorderPlaylist: true,
    });
    if (res.success) {
      if (res.data?.state) setYoutube(res.data.state);
      const actions = res.data?.actions;
      toast.success(
        deleteDuplicates
          ? `Synced. Removed ${actions?.deleted.length || 0} duplicate(s).`
          : "YouTube links saved to the database.",
      );
      if (actions?.warnings?.length) {
        toast.error(actions.warnings[0]);
      }
      await load();
    } else {
      toast.error(res.message || "Failed to sync with YouTube.");
    }
    setSyncing(false);
  };

  /** Uploads the image of the course. It becomes the background of the
   *  YouTube thumbnail of every lesson published from the course. */
  const uploadImage = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Pick an image file.");
      return;
    }

    setImageUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || "");
      const res = await api.post<{ thumbnailUrl: string }>(
        `/api/courses/${id}/thumbnail`,
        { thumbnailDataUrl: dataUrl },
      );
      if (res.success) {
        toast.success("Course image updated.");
        await load();
      } else {
        toast.error(res.message || "Failed to upload the image.");
      }
      setImageUploading(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    };
    reader.onerror = () => {
      setImageUploading(false);
      toast.error("Could not read the image.");
    };
    reader.readAsDataURL(file);
  };

  const addVideo = async (videoId: string) => {
    const res = await api.post(`/api/courses/${id}/videos`, { videoIds: [videoId] });
    if (res.success) {
      toast.success(res.message || "Video added.");
      await load();
    } else {
      toast.error(res.message || "Failed to add the video.");
    }
  };

  const lessonBaseKey = (name: string) =>
    name
      .replace(/\.[^.]+$/, "")
      .trim()
      .toLowerCase()
      .replace(/[._\s]+/g, " ")
      .trim();

  const lessonBaseKeyLoose = (name: string) =>
    lessonBaseKey(name).replace(/\s+(ar|en|es|fr|de|tr|pt|ru|it|zh|ja|ko|hi|ur|ara|eng|spa)$/i, "").trim();

  const pairSubtitlesToVideos = (videos: File[], subtitles: File[]) => {
    const used = new Set<number>();
    const findMatch = (video: File) => {
      const k1 = lessonBaseKey(video.name);
      const k2 = lessonBaseKeyLoose(video.name);
      let idx = subtitles.findIndex((s, i) => !used.has(i) && lessonBaseKey(s.name) === k1);
      if (idx < 0) idx = subtitles.findIndex((s, i) => !used.has(i) && lessonBaseKeyLoose(s.name) === k1);
      if (idx < 0) idx = subtitles.findIndex((s, i) => !used.has(i) && lessonBaseKey(s.name) === k2);
      if (idx < 0) idx = subtitles.findIndex((s, i) => !used.has(i) && lessonBaseKeyLoose(s.name) === k2);
      if (idx >= 0) used.add(idx);
      return idx >= 0 ? subtitles[idx] : null;
    };
    return videos.map((video, i) => {
      const baseName = video.name.replace(/\.[^.]+$/, "").trim() || video.name;
      return {
        key: `${i}-${video.name}-${video.size}-${video.lastModified}`,
        video,
        subtitle: findMatch(video),
        baseName,
        status: "pending" as const,
      };
    });
  };

  const onSelectLessonVideos = (files: FileList | null) => {
    const videos = files ? Array.from(files) : [];
    if (!videos.length) return;
    const next = pairSubtitlesToVideos(videos, stagedSubtitlePool);
    setStagedLessons(next);
  };

  const onSelectLessonSubtitles = (files: FileList | null) => {
    const subs = files ? Array.from(files) : [];
    setStagedSubtitlePool(subs);
    setStagedLessons((prev) => {
      const videos = prev.map((p) => p.video);
      if (!videos.length) return prev;
      return pairSubtitlesToVideos(videos, subs);
    });
  };

  const clearStagedLessons = () => {
    if (stagingUploading) return;
    setStagedLessons([]);
    setStagedSubtitlePool([]);
    setStagingOverall("");
    if (videoFilesInputRef.current) videoFilesInputRef.current.value = "";
    if (subtitleFilesInputRef.current) subtitleFilesInputRef.current.value = "";
  };

  const setStagedLessonState = (key: string, patch: Partial<StagedLesson>) => {
    setStagedLessons((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const uploadStagedLessons = async () => {
    if (!stagedLessons.length || stagingUploading) return;
    setStagingUploading(true);
    setUploadProgress(0);
    const createdIds: string[] = [];
    let failed = 0;

    for (let i = 0; i < stagedLessons.length; i++) {
      const item = stagedLessons[i];
      setStagingOverall(`درس ${i + 1} من ${stagedLessons.length}: ${item.baseName}`);
      setUploadProgress(Math.round((i / stagedLessons.length) * 100));
      try {
        setStagedLessonState(item.key, { status: "uploading", message: "جارٍ رفع الفيديو..." });
        const formData = new FormData();
        formData.append("video", item.video);
        formData.append("title", item.baseName || item.video.name);
        formData.append("originalFilename", item.video.name);
        formData.append("description", "");
        formData.append("originalLanguage", newLessonLanguage);
        formData.append("targetLanguages", JSON.stringify([language]));

        const res = await api.upload<{ video: { _id: string } }>(
          "/api/videos/upload",
          formData,
          (p) => setUploadProgress(Math.round(((i + p / 100) / stagedLessons.length) * 100)),
        );
        if (!res.success || !res.data?.video?._id) {
          throw new Error(res.message || "فشل رفع الفيديو");
        }
        const videoId = res.data.video._id;

        if (item.subtitle) {
          setStagedLessonState(item.key, { status: "subtitle", message: "جارٍ رفع ملف الترجمة...", videoId });
          const fd = new FormData();
          fd.append("file", item.subtitle);
          fd.append("language", newLessonLanguage);
          const imp = await api.upload(`/api/videos/${videoId}/transcript/import`, fd);
          if (!imp.success) {
            throw new Error(imp.message || "فشل رفع ملف الترجمة");
          }
        }

        setStagedLessonState(item.key, { status: "processing", message: "جارٍ بدء المعالجة...", videoId });
        try {
          await api.post(`/api/videos/${videoId}/process`);
        } catch {
          // يمكن بدء المعالجة لاحقاً
        }

        createdIds.push(videoId);
        setStagedLessonState(item.key, { status: "done", message: item.subtitle ? "تم الرفع وربط ملف الترجمة" : "تم رفع الفيديو (بدون ملف ترجمة)", videoId });
      } catch (e) {
        failed += 1;
        const msg = e instanceof Error ? e.message : "حدث خطأ";
        setStagedLessonState(item.key, { status: "error", message: msg });
        toast.error(`${item.baseName}: ${msg}`);
      }
    }

    if (createdIds.length) {
      setStagingOverall("جارٍ إضافة الدروس للكورس بالترتيب...");
      setStagedLessons((prev) => prev.map((l) => (createdIds.includes(l.videoId || "") && l.status === "done" ? { ...l, status: "adding", message: "جارٍ الإضافة للكورس..." } : l)));
      const added = await api.post(`/api/courses/${id}/videos`, { videoIds: createdIds });
      if (added.success) {
        toast.success(`تمت إضافة ${createdIds.length} درس للكورس بالترتيب.`);
        setStagedLessons((prev) => prev.map((l) => (createdIds.includes(l.videoId || "") ? { ...l, status: "done", message: l.subtitle ? "تم الرفع والإضافة مع ملف الترجمة" : "تم الرفع والإضافة" } : l)));
      } else {
        toast.error(added.message || "تم رفع الدروس لكن فشلت إضافتها للكورس.");
      }
    }

    setUploadProgress(100);
    setStagingOverall(failed ? `اكتمل مع أخطاء (${failed})` : "اكتمل");
    setStagingUploading(false);
    await load();
  };

  /** Kept for backward-compat if referenced; use staged upload UI instead. */
  const uploadLesson = async (_file?: File | null) => {
    toast.error("اختر ملفات الفيديو وملفات الترجمة من قسم الرفع المتعدد ثم اضغط رفع.");
  };

  const removeVideo = async (
    videoId: string,
    opts?: { missing?: boolean; published?: boolean; order?: number },
  ) => {
    const hasId = Boolean(videoId);
    const hasOrder = Number.isFinite(opts?.order);
    if (!hasId && !hasOrder) {
      toast.error("This lesson has no video to remove.");
      return;
    }
    const notes = [
      "This removes the lesson from this course list only (it does not delete the video file or your YouTube views).",
      opts?.published
        ? "The lesson is published on YouTube — removing it here will not delete/unpublish the YouTube video or remove it from the playlist."
        : opts?.missing || !hasId
          ? "This lesson's video record is missing or it was removed from the YouTube playlist — you can safely remove it from this course to free its slot/order."
          : "If it is already on a YouTube playlist, remove or reorder it there via YouTube sync if needed.",
    ].join("\n\n");
    if (!confirm(`Remove this lesson from the course?\n\n${notes}`)) return;
    const target = hasId ? videoId : "entry";
    const query = !hasId && hasOrder ? `?order=${opts!.order}` : "";
    const res = await api.delete(`/api/courses/${id}/videos/${target}${query}`);
    if (res.success) {
      toast.success(res.message || "Lesson removed from the course.");
      await load();
    } else {
      toast.error(res.message || "Failed to remove the lesson.");
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    if (!course) return;
    const ids = course.videos
      .map((entry) => entry.video?._id || entry.videoId)
      .filter(Boolean) as string[];
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];

    const res = await api.put(`/api/courses/${id}/videos/order`, { videoIds: ids });
    if (res.success) {
      await load();
    } else {
      toast.error(res.message || "Failed to reorder the lessons.");
    }
  };

  /** Reorders the lessons with a drag and drop gesture. */
  const reorderByDrop = async (from: number, to: number) => {
    if (!course) return;
    const ids = course.videos
      .map((entry) => entry.video?._id || entry.videoId)
      .filter(Boolean) as string[];
    if (from < 0 || from >= ids.length) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    let toIndex = to;
    if (from < to) toIndex = to - 1;
    next.splice(toIndex, 0, moved);
    const res = await api.put(`/api/courses/${id}/videos/order`, { videoIds: next });
    if (res.success) {
      await load();
    } else {
      toast.error(res.message || "Failed to reorder the lessons.");
    }
  };

  const deleteCourse = async () => {
    if (!course) return;
    if (!window.confirm(`Delete the course "${course.title}"?`)) return;
    const res = await api.delete(`/api/courses/${id}`);
    if (res.success) {
      toast.success(res.message || "Course deleted.");
      router.push("/courses/new");
    } else {
      toast.error(res.message || "Failed to delete the course.");
    }
  };

  const inCourse = new Set(
    (course?.videos || []).map((entry) => entry.video?._id).filter(Boolean) as string[],
  );
  const videoToCourses = (() => {
    const map = new Map<string, CourseSummary[]>();
    for (const c of allCourses) {
      for (const entry of c.videos || []) {
        const vid =
          typeof entry.video === "string"
            ? entry.video
            : entry.video?._id || entry.videoId || null;
        if (!vid) continue;
        const list = map.get(String(vid)) || [];
        if (!list.some((x) => x._id === c._id)) list.push(c);
        map.set(String(vid), list);
      }
    }
    return map;
  })();
  const available = allVideos.filter((video) => {
    if (inCourse.has(video._id)) return false;
    if (lessonCourseFilter === "all") return true;
    const owners = videoToCourses.get(video._id) || [];
    if (lessonCourseFilter === "none") return owners.length === 0;
    return owners.some((c) => c._id === lessonCourseFilter);
  });
  const publishing = course?.publishing;
  const isPublishing = publishing?.status === "processing";
  const ytByVideo = new Map(
    (youtube?.lessons || []).map((lesson) => [lesson.videoId, lesson]),
  );

  return (
    <AuthGuard>
      <AppShell
        title={course?.title || "Course"}
        description={
          course
            ? `${course.videos.length} lesson${course.videos.length === 1 ? "" : "s"} • ${languageLabel(course.language)}`
            : undefined
        }
        actions={
          <Link
            href="/courses/new"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            All courses
          </Link>
        }
      >
        <div className="space-y-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !course ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-destructive">Course not found.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Where it is published</CardTitle>
                  <CardDescription>
                    The channel and playlist that hold this course.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border p-3">
                      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <Tv className="size-3.5" />
                        Channel
                      </p>
                      <p className="mt-1 truncate text-sm font-medium">
                        {course.channelTitle || "Not connected"}
                      </p>
                      {course.channelTitle && (
                        <p className="text-xs text-muted-foreground">
                          Publishes in {languageLabel(course.channelLanguage)}
                        </p>
                      )}
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <ListVideo className="size-3.5" />
                        Playlist
                      </p>
                      <p className="mt-1 truncate text-sm font-medium">
                        {course.playlistTitle || "Created when publishing"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        One playlist per course
                      </p>
                    </div>
                  </div>

                  {publishing?.status === "failed" && publishing.error && (
                    <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                      Last publish failed: {publishing.error}
                    </p>
                  )}

                  {isPublishing && (
                    <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <Radio className="size-4 animate-pulse text-primary" />
                        Publishing {publishing.publishedCount} of{" "}
                        {publishing.total} lessons…
                      </p>
                      <Progress value={publishing.progress} />
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      onClick={generateMissingDubs}
                      disabled={dubbing || isPublishing || missing.length === 0}
                    >
                      {dubbing ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : (
                        <Languages className="mr-2 size-4" />
                      )}
                      {missing.length === 0
                        ? `All lessons ready in ${language}`
                        : `Generate ${missing.length} ${language} dub${missing.length === 1 ? "" : "s"}`}
                    </Button>
                    <Button
                      onClick={publishCourse}
                      disabled={isPublishing || course.videos.length === 0}
                    >
                      {isPublishing ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : (
                        <Tv className="mr-2 size-4" />
                      )}
                      Publish course to YouTube
                    </Button>
                    <Badge
                      variant={course.status === "published" ? "default" : "secondary"}
                      className="ml-auto"
                    >
                      {course.status === "published" ? "Published" : "Draft"}
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Tv className="size-4" />
                    YouTube status
                  </CardTitle>
                  <CardDescription>
                    Read from the channel and the playlist itself, not from the
                    database. This is what viewers see right now.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {loadingYoutube && !youtube ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      Reading YouTube…
                    </p>
                  ) : !youtube ? (
                    <p className="text-sm text-muted-foreground">
                      Could not read the YouTube state.
                    </p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge>
                          {youtube.summary.published} of {youtube.summary.lessons}{" "}
                          published
                        </Badge>
                        <Badge variant="outline">
                          {youtube.summary.inPlaylist} in the playlist
                        </Badge>
                        <Badge
                          variant={
                            youtube.summary.duplicates ? "destructive" : "secondary"
                          }
                        >
                          {youtube.summary.duplicates} duplicate
                          {youtube.summary.duplicates === 1 ? "" : "s"}
                        </Badge>
                        {(youtube.course.playlistUrl || course?.playlistId) && (
                          <a
                            href={
                              youtube.course.playlistUrl ||
                              (course?.playlistId
                                ? `https://www.youtube.com/playlist?list=${course.playlistId}`
                                : "")
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            <ExternalLink className="size-3" />
                            Open playlist
                          </a>
                        )}
                      </div>

                      <ol className="space-y-2">
                        {youtube.lessons.map((lesson) => (
                          <li
                            key={lesson.videoId}
                            className="rounded-lg border p-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold">
                                {lesson.lessonNumber ?? "?"}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                {lesson.title}
                              </span>
                              {lesson.published ? (
                                <a
                                  href={lesson.youtubeUrl || "#"}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                >
                                  <ExternalLink className="size-3" />
                                  Watch on YouTube
                                </a>
                              ) : (
                                <Badge variant="secondary" className="text-[10px]">
                                  not on YouTube
                                </Badge>
                              )}
                            </div>
                            {lesson.published && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {lesson.youtubeTitle} · uploaded{" "}
                                {formatDate(lesson.publishedAt)} ·{" "}
                                {lesson.inPlaylist
                                  ? `playlist position ${
                                      (lesson.playlistPosition ?? 0) + 1
                                    }`
                                  : "not in the playlist"}
                                {lesson.duplicates.length
                                  ? ` · ${lesson.duplicates.length} older copy${
                                      lesson.duplicates.length === 1 ? "" : "ies"
                                    }`
                                  : ""}
                              </p>
                            )}
                          </li>
                        ))}
                      </ol>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => loadYouTube()}
                          disabled={loadingYoutube || syncing}
                        >
                          <RefreshCw
                            className={cn(
                              "mr-1 size-3.5",
                              loadingYoutube && "animate-spin",
                            )}
                          />
                          Refresh from YouTube
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => syncYouTube(false)}
                          disabled={syncing}
                        >
                          Save YouTube links to the database
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => syncYouTube(true)}
                          disabled={syncing || youtube.summary.duplicates === 0}
                        >
                          Remove duplicates & reorder
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Course details</CardTitle>
                  <CardDescription>
                    The title and description shown to your viewers.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={saveDetails} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="courseImage">Course image</Label>
                      <div className="flex items-start gap-3">
                        <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
                          {course.thumbnailUrl ? (
                            <img
                              src={course.thumbnailUrl}
                              alt="Course image"
                              className="size-full object-cover"
                            />
                          ) : (
                            <ImageIcon className="size-6 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1 space-y-2">
                          <input
                            ref={imageInputRef}
                            id="courseImage"
                            type="file"
                            accept="image/*"
                            disabled={imageUploading}
                            onChange={(e) => uploadImage(e.target.files?.[0])}
                            className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80 disabled:opacity-50"
                          />
                          <p className="text-xs text-muted-foreground">
                            {imageUploading
                              ? "Uploading…"
                              : course.thumbnailUrl
                                ? "This image is the background of the YouTube thumbnail of every lesson of the course."
                                : "No image yet. Upload one to use it as the background of the YouTube thumbnails."}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="detailTitle">Title</Label>
                      <Input
                        id="detailTitle"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="detailDescription">Description</Label>
                      <textarea
                        id="detailDescription"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="min-h-24 w-full rounded-md border-2 border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="detailLanguage">Course language</Label>
                      <select
                        id="detailLanguage"
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        className={fieldClass}
                      >
                        {LANGUAGES.map((option) => (
                          <option key={option.code} value={option.code}>
                            {option.label} ({option.code})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex justify-end">
                      <Button type="submit" size="sm" disabled={saving}>
                        {saving ? "Saving…" : "Save changes"}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Lessons</CardTitle>
                  <CardDescription>
                    The order below is the order the lessons are played.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Upload new lessons (multiple) with paired translation files */}
                  <div className="space-y-3 rounded-lg border border-dashed p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Upload new lessons
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="newLessonLanguage">Spoken language of the videos</Label>
                        <select
                          id="newLessonLanguage"
                          value={newLessonLanguage}
                          onChange={(e) => setNewLessonLanguage(e.target.value)}
                          disabled={stagingUploading}
                          className={fieldClass}
                        >
                          {LANGUAGES.map((option) => (
                            <option key={option.code} value={option.code}>
                              {option.label} ({option.code})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="newLessonVideos">Video files (multiple, in order)</Label>
                        <input
                          ref={videoFilesInputRef}
                          id="newLessonVideos"
                          type="file"
                          accept="video/*"
                          multiple
                          disabled={stagingUploading}
                          onChange={(e) => onSelectLessonVideos(e.target.files)}
                          className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80 disabled:opacity-50"
                        />
                        <p className="text-[11px] text-muted-foreground">
                          سيتم تسمية كل درس بنفس اسم ملف الفيديو.
                        </p>
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="newLessonSubtitles">Translation/subtitle files (.srt/.vtt) — paired by file name</Label>
                        <input
                          ref={subtitleFilesInputRef}
                          id="newLessonSubtitles"
                          type="file"
                          accept=".srt,.vtt,text/vtt,application/x-subrip"
                          multiple
                          disabled={stagingUploading}
                          onChange={(e) => onSelectLessonSubtitles(e.target.files)}
                          className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80 disabled:opacity-50"
                        />
                        <p className="text-[11px] text-muted-foreground">
                          اختر كل ملفات الترجمة مرة واحدة وسيتم مطابقة كل ملف فيديو بملف الترجمة الذي له نفس الاسم (وبنفس الترتيب). يمكنك تغيير ملف الترجمة لكل درس قبل الرفع.
                        </p>
                      </div>
                    </div>

                    {stagedLessons.length > 0 && (
                      <div className="space-y-2 rounded-md border bg-muted/20 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">مراجعة الدروس قبل الرفع ({stagedLessons.length})</p>
                          <Button type="button" variant="ghost" size="sm" onClick={clearStagedLessons} disabled={stagingUploading}>
                            مسح القائمة
                          </Button>
                        </div>
                        <div className="space-y-2">
                          {stagedLessons.map((item, idx) => (
                            <div key={item.key} className="rounded-md border bg-background p-2">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0 flex-1 space-y-1">
                                  <p className="text-sm font-medium truncate">
                                    {idx + 1}. {item.baseName}
                                  </p>
                                  <p className="text-xs text-muted-foreground truncate">فيديو: {item.video.name}</p>
                                  <div className="flex flex-wrap items-center gap-2 text-xs">
                                    <span className="text-muted-foreground">ملف الترجمة:</span>
                                    {item.subtitle ? (
                                      <Badge variant="secondary" className="text-[10px]">{item.subtitle.name}</Badge>
                                    ) : (
                                      <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300">لا يوجد ملف ترجمة مطابق</Badge>
                                    )}
                                    <label className={cn("cursor-pointer text-[11px] text-primary underline underline-offset-2", stagingUploading && "pointer-events-none opacity-50")}>
                                      {item.subtitle ? "تغيير" : "اختيار ملف"}
                                      <input
                                        type="file"
                                        accept=".srt,.vtt,text/vtt,application/x-subrip"
                                        className="hidden"
                                        disabled={stagingUploading}
                                        onChange={(e) => {
                                          const f = e.target.files?.[0] || null;
                                          setStagedLessons((prev) => prev.map((l) => (l.key === item.key ? { ...l, subtitle: f } : l)));
                                          e.currentTarget.value = "";
                                        }}
                                      />
                                    </label>
                                  </div>
                                  {item.message && (
                                    <p className={cn("text-xs", item.status === "error" ? "text-destructive" : item.status === "done" ? "text-green-700" : "text-muted-foreground")}>
                                      {item.message}
                                    </p>
                                  )}
                                </div>
                                <div className="shrink-0">
                                  <Badge
                                    variant={item.status === "done" ? "default" : item.status === "error" ? "destructive" : "secondary"}
                                    className="text-[10px]"
                                  >
                                    {item.status === "pending" ? "جاهز" : item.status === "uploading" ? "رفع الفيديو" : item.status === "subtitle" ? "رفع الترجمة" : item.status === "processing" ? "معالجة" : item.status === "adding" ? "إضافة للكورس" : item.status === "done" ? "تم" : "خطأ"}
                                  </Badge>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <Button type="button" onClick={uploadStagedLessons} disabled={stagingUploading || stagedLessons.length === 0}>
                            {stagingUploading ? "جارٍ الرفع..." : `رفع ${stagedLessons.length} درس بالترتيب`}
                          </Button>
                          {stagingOverall && <span className="text-xs text-muted-foreground">{stagingOverall}</span>}
                        </div>
                        {(stagingUploading || uploadProgress > 0) && (
                          <div className="space-y-1">
                            <Progress value={uploadProgress} />
                            <p className="text-xs text-muted-foreground">التقدّم: {uploadProgress}%</p>
                          </div>
                        )}
                      </div>
                    )}

                    <p className="text-xs text-muted-foreground">
                      يتم رفع كل فيديو وربطه بملف الترجمة المطابق له (إن وُجد) بالترتيب، ثم إضافته للكورس بنفس الترتيب. عند الدبلجة لاحقاً سيُستخدم الفيديو مع ملف الترجمة/التوقيت المرتبط به لكل درس.
                    </p>
                  </div>
                  {course.videos.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No lessons yet. Add one from the list below.
                    </p>
                  ) : (
                    <ol className="space-y-2">
                      {course.videos.map((entry, index) => {
                        const ready = hasVersion(entry, language);
                        return (
                          <li
                            key={entry.video?._id || entry.videoId || index}
                            draggable={!isPublishing}
                            onDragStart={(e) => {
                              setDragIndex(index);
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", String(index));
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              setDragOverIndex(index);
                            }}
                            onDragLeave={() => {
                              if (dragOverIndex === index) setDragOverIndex(null);
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              setDragOverIndex(null);
                              setDragIndex(null);
                              if (dragIndex !== null) reorderByDrop(dragIndex, index);
                            }}
                            onDragEnd={() => {
                              setDragIndex(null);
                              setDragOverIndex(null);
                            }}
                            className={cn(
                              "flex items-center gap-3 rounded-lg border p-3",
                              dragOverIndex === index && dragIndex !== index
                                ? "border-primary"
                                : "border",
                              dragIndex === index ? "opacity-60" : undefined,
                            )}
                          >
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                              {index + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              {entry.video?._id ? (
                                <Link
                                  href={`/videos/${entry.video._id}`}
                                  className="flex items-center gap-1.5 truncate text-sm font-medium hover:underline"
                                >
                                  <PlayCircle className="size-4 shrink-0 text-muted-foreground" />
                                  <span className="truncate">{entry.video.title}</span>
                                </Link>
                              ) : (
                                <div className="flex items-center gap-1.5 truncate text-sm font-medium text-muted-foreground">
                                  <PlayCircle className="size-4 shrink-0" />
                                  <span className="truncate">Removed / missing lesson</span>
                                  <span className="shrink-0 text-xs font-normal">(can be removed from course)</span>
                                </div>
                              )}
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">
                                  {entry.video?.status || "missing"}
                                </span>
                                {!entry.video && (
                                  <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">
                                    Not in library{entry.youtubeVideoId ? "" : " / not on YouTube"}
                                  </Badge>
                                )}
                                {(() => {
                                  const vidId = entry.video?._id || entry.videoId || "";
                                  const ytLesson = vidId ? ytByVideo.get(vidId) : null;
                                  const link = ytLesson?.youtubeUrl || entry.youtubeUrl;
                                  if (link) {
                                    return (
                                      <a
                                        href={link}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                      >
                                        <ExternalLink className="size-3" />
                                        Published on YouTube
                                      </a>
                                    );
                                  }
                                  return ready ? (
                                    <Badge variant="outline" className="text-[10px]">
                                      {language} ready
                                    </Badge>
                                  ) : (
                                    <Badge variant="secondary" className="text-[10px]">
                                      needs {language} dub
                                    </Badge>
                                  );
                                })()}
                              </div>
                              {entry.video?._id && dubProgress[entry.video._id] && (
                                <div className="mt-2 space-y-1">
                                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span>
                                      Dubbing… {dubProgress[entry.video._id].status}
                                    </span>
                                    <span>{dubProgress[entry.video._id].progress}%</span>
                                  </div>
                                  <Progress value={dubProgress[entry.video._id].progress} />
                                  {dubProgress[entry.video._id].error && (
                                    <p className="text-xs text-destructive">
                                      {dubProgress[entry.video._id].error}
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => move(index, -1)}
                              disabled={index === 0 || isPublishing}
                              aria-label="Move lesson up"
                            >
                              ↑
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => move(index, 1)}
                              disabled={index === course.videos.length - 1 || isPublishing}
                              aria-label="Move lesson down"
                            >
                              ↓
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => {
                                const vidId = entry.video?._id || entry.videoId || "";
                                const yt = vidId ? ytByVideo.get(vidId) : null;
                                removeVideo(vidId, {
                                  missing: !entry.video,
                                  published: Boolean(yt?.published || entry.youtubeUrl || entry.youtubeVideoId),
                                  order: index,
                                });
                              }}
                              disabled={isPublishing}
                              aria-label="Remove lesson"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </li>
                        );
                      })}
                    </ol>
                  )}



                </CardContent>
              </Card>

              <div className="flex flex-wrap justify-between gap-2">
                <Link
                  href="/videos"
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                >
                  <ArrowLeft className="mr-1 size-4" />
                  Back to videos
                </Link>
                <Button variant="destructive" size="sm" onClick={deleteCourse}>
                  <Trash2 className="mr-1 size-4" />
                  Delete course
                </Button>
              </div>

              <div className="flex justify-center">
                <Link
                  href="/courses/new"
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                >
                  <BookOpen className="mr-1 size-4" />
                  All courses
                </Link>
              </div>
            </>
          )}
        </div>
      </AppShell>
    </AuthGuard>
  );
}
