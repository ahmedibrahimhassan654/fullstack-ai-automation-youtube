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
import { api, API_BASE } from "@/lib/api";
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

type VideoRow = { _id: string; title: string; status: string };

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
  const [imageUploading, setImageUploading] = useState(false);
  const [youtube, setYoutube] = useState<YouTubeState | null>(null);
  const [loadingYoutube, setLoadingYoutube] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await api.get<{ course: Course }>(`/api/courses/${id}`);
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
  }, [id, toast]);

  useEffect(() => {
    // When the server already provided the course (SSR), skip the initial
    // fetch and only load the supplementary video list.
    if (!initialCourse) load();
    api
      .get<{ items: VideoRow[] }>("/api/videos?limit=100")
      .then((res) => {
        if (res.success) setAllVideos(res.data?.items || []);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, initialCourse]);

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

  /** Dubs every lesson that has no version in the course language yet. */
  const generateMissingDubs = async () => {
    if (!missing.length) {
      toast.success("Every lesson already has a version in this language.");
      return;
    }
    setDubbing(true);
    setDubProgress({});

    const token = api.getToken();
    let remaining = missing.length;
    let done = 0;
    let failed = 0;

    const finishAll = async () => {
      if (remaining > 0) return;
      setDubbing(false);
      toast.success(
        failed === 0
          ? `Finished ${done} dub${done === 1 ? "" : "s"}.`
          : `Finished ${done} of ${missing.length} dubs (${failed} failed).`,
      );
      await load();
      // Clear progress after a short delay so the user sees 100%.
      setTimeout(() => setDubProgress({}), 4000);
    };

    for (const entry of missing) {
      const videoId = String(entry.video?._id || "");
      if (!videoId) {
        remaining -= 1;
        failed += 1;
        void finishAll();
        continue;
      }

      // Track this video's progress via SSE.
      setDubProgress((prev) => ({
        ...prev,
        [videoId]: { status: "processing", progress: 0 },
      }));

      if (token) {
        const es = new EventSource(
          `${API_BASE}/api/videos/${videoId}/events?token=${encodeURIComponent(token)}`,
        );
        es.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "connected") return;
            const dubbingState = data.dubbing;
            if (dubbingState) {
              setDubProgress((prev) => ({
                ...prev,
                [videoId]: {
                  status: dubbingState.status || "processing",
                  progress:
                    typeof dubbingState.progress === "number"
                      ? dubbingState.progress
                      : prev[videoId]?.progress ?? 0,
                  error: dubbingState.error ?? null,
                },
              }));
              if (dubbingState.status === "completed") {
                done += 1;
                remaining -= 1;
                es.close();
                void finishAll();
              } else if (dubbingState.status === "failed") {
                failed += 1;
                remaining -= 1;
                es.close();
                void finishAll();
              }
            }
          } catch {
            // ignore parse errors
          }
        };
        es.onerror = () => {
          // Fall back: close; the POST below already kicked it off.
        };
      }

      const res = await api.post(`/api/videos/${videoId}/dub`, { language });
      if (!res.success) {
        setDubProgress((prev) => ({
          ...prev,
          [videoId]: { status: "failed", progress: 0, error: res.message || "Failed to start" },
        }));
        failed += 1;
        remaining -= 1;
        void finishAll();
      }
    }
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

  /**
   * Uploads a brand new video and makes it a lesson of this course. The
   * course language is the target, so the lesson is dubbed into it.
   */
  const uploadLesson = async (file?: File | null) => {
    if (!file) return;

    setUploading(true);
    setUploadProgress(0);
    toast.success("Upload started…");

    const formData = new FormData();
    formData.append("video", file);
    formData.append("title", file.name.replace(/\.[^.]+$/, ""));
    formData.append("description", "");
    formData.append("originalLanguage", newLessonLanguage);
    formData.append("targetLanguages", JSON.stringify([language]));

    const res = await api.upload<{ video: { _id: string } }>(
      "/api/videos/upload",
      formData,
      setUploadProgress,
    );

    if (!res.success || !res.data?.video?._id) {
      toast.error(res.message || "The upload failed.");
      setUploading(false);
      return;
    }

    const videoId = res.data.video._id;

    // Transcribe it, then make it a lesson of this course.
    try {
      await api.post(`/api/videos/${videoId}/process`);
    } catch {
      // Processing can also be started later from the video page.
    }

    const added = await api.post(`/api/courses/${id}/videos`, { videoIds: [videoId] });
    if (added.success) {
      toast.success("Lesson uploaded and added to the course.");
    } else {
      toast.error(added.message || "The video was uploaded but not added.");
    }

    setUploading(false);
    setUploadProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
    await load();
  };

  const removeVideo = async (videoId: string, opts?: { missing?: boolean; published?: boolean }) => {
    if (!videoId) {
      toast.error("This lesson has no video to remove.");
      return;
    }
    const notes = [
      "This removes the lesson from this course list only (it does not delete the video file or your YouTube views).",
      opts?.published
        ? "The lesson is published on YouTube — removing it here will not delete/unpublish the YouTube video or remove it from the playlist."
        : opts?.missing
          ? "This lesson's video record is missing or it was removed from the YouTube playlist — you can safely remove it from this course."
          : "If it is already on a YouTube playlist, remove or reorder it there via YouTube sync if needed.",
    ].join("\n\n");
    if (!confirm(`Remove this lesson from the course?\n\n${notes}`)) return;
    const res = await api.delete(`/api/courses/${id}/videos/${videoId}`);
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
  const available = allVideos.filter((video) => !inCourse.has(video._id));
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
                              onClick={() =>
                                removeVideo(entry.video?._id || entry.videoId || "", {
                                  missing: !entry.video,
                                  published: Boolean(ytLesson?.published || entry.youtubeUrl || entry.youtubeVideoId),
                                })
                              }
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

                  {available.length > 0 && (
                    <div className="space-y-2 rounded-lg border border-dashed p-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Add an existing lesson
                      </p>
                      <div className="space-y-1">
                        {available.map((video) => (
                          <div
                            key={video._id}
                            className="flex items-center gap-3 rounded-md px-1 py-1.5 hover:bg-muted/50"
                          >
                            <span className="min-w-0 flex-1 truncate text-sm">
                              {video.title}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => addVideo(video._id)}
                            >
                              <Plus className="mr-1 size-3.5" />
                              Add
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Upload a brand new video straight into the course */}
                  <div className="space-y-2 rounded-lg border border-dashed p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Upload a new lesson
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <div className="space-y-1.5">
                        <Label htmlFor="newLessonLanguage">
                          Spoken language of the new video
                        </Label>
                        <select
                          id="newLessonLanguage"
                          value={newLessonLanguage}
                          onChange={(e) => setNewLessonLanguage(e.target.value)}
                          className={fieldClass}
                        >
                          {LANGUAGES.map((option) => (
                            <option key={option.code} value={option.code}>
                              {option.label} ({option.code})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <Label htmlFor="newLessonFile">Video file</Label>
                        <input
                          ref={fileInputRef}
                          id="newLessonFile"
                          type="file"
                          accept="video/*"
                          disabled={uploading}
                          onChange={(e) => uploadLesson(e.target.files?.[0])}
                          className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
                        />
                      </div>
                    </div>
                    {uploading && (
                      <div className="space-y-1">
                        <Progress value={uploadProgress} />
                        <p className="text-xs text-muted-foreground">
                          Uploading… {uploadProgress}%
                        </p>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      The video is uploaded, transcribed and added as the last
                      lesson. Use the dub button above to dub it into{" "}
                      {language}.
                    </p>
                  </div>
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
