"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  ExternalLink,
  Languages,
  ListVideo,
  Loader2,
  PlayCircle,
  Plus,
  Radio,
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

const fieldClass =
  "h-9 w-full rounded-md border-2 border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";

export default function CourseDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();

  const [course, setCourse] = useState<Course | null>(null);
  const [allVideos, setAllVideos] = useState<VideoRow[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState("en");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dubbing, setDubbing] = useState(false);

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
    load();
    api
      .get<{ items: VideoRow[] }>("/api/videos?limit=100")
      .then((res) => {
        if (res.success) setAllVideos(res.data?.items || []);
      });
  }, [load]);

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
    let done = 0;
    for (const entry of missing) {
      const res = await api.post(`/api/videos/${entry.video?._id}/dub`, {
        language,
      });
      if (res.success) done += 1;
    }
    toast.success(
      done === missing.length
        ? `Started ${done} dub${done === 1 ? "" : "s"}. They appear on the lesson once ready.`
        : `Started ${done} of ${missing.length} dubs.`,
    );
    setDubbing(false);
    await load();
  };

  const publishCourse = async () => {
    const res = await api.post(`/api/courses/${id}/publish`);
    if (res.success) {
      toast.success(res.message || "Publishing started.");
      await load();
    } else {
      toast.error(res.message || "Failed to publish the course.");
    }
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

  const removeVideo = async (videoId: string) => {
    const res = await api.delete(`/api/courses/${id}/videos/${videoId}`);
    if (res.success) {
      toast.success(res.message || "Video removed.");
      await load();
    } else {
      toast.error(res.message || "Failed to remove the video.");
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    if (!course) return;
    const ids = course.videos
      .map((entry) => entry.video?._id)
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
                  <CardTitle>Course details</CardTitle>
                  <CardDescription>
                    The title and description shown to your viewers.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={saveDetails} className="space-y-4">
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
                            key={entry.video?._id || index}
                            className="flex items-center gap-3 rounded-lg border p-3"
                          >
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                              {index + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <Link
                                href={`/videos/${entry.video?._id}`}
                                className="flex items-center gap-1.5 truncate text-sm font-medium hover:underline"
                              >
                                <PlayCircle className="size-4 shrink-0 text-muted-foreground" />
                                <span className="truncate">
                                  {entry.video?.title || "Removed video"}
                                </span>
                              </Link>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">
                                  {entry.video?.status}
                                </span>
                                {entry.youtubeUrl ? (
                                  <a
                                    href={entry.youtubeUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                  >
                                    <ExternalLink className="size-3" />
                                    Published
                                  </a>
                                ) : ready ? (
                                  <Badge variant="outline" className="text-[10px]">
                                    {language} ready
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary" className="text-[10px]">
                                    needs {language} dub
                                  </Badge>
                                )}
                              </div>
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
                              onClick={() => removeVideo(entry.video?._id || "")}
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
                        Add a lesson
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
