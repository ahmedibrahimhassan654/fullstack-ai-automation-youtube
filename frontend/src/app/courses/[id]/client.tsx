"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  ExternalLink,
  Loader2,
  PlayCircle,
  Plus,
  Trash2,
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
import { LANGUAGES, languageLabel } from "@/lib/languages";
import { cn } from "@/lib/utils";

type CourseVideo = {
  order: number;
  video: {
    _id: string;
    title: string;
    status: string;
    durationSeconds?: number;
  } | null;
};

type Course = {
  _id: string;
  title: string;
  description?: string;
  language?: string;
  createdAt?: string;
  status?: string;
  videos: CourseVideo[];
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
                      {course.videos.map((entry, index) => (
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
                            <p className="text-xs text-muted-foreground">
                              {entry.video?.status}
                              {entry.video?.durationSeconds
                                ? ` • ${Math.round(entry.video.durationSeconds)}s`
                                : ""}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => move(index, -1)}
                            disabled={index === 0}
                            aria-label="Move lesson up"
                          >
                            ↑
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => move(index, 1)}
                            disabled={index === course.videos.length - 1}
                            aria-label="Move lesson down"
                          >
                            ↓
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => removeVideo(entry.video?._id || "")}
                            aria-label="Remove lesson"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </li>
                      ))}
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

              <Card>
                <CardHeader>
                  <CardTitle>Publishing</CardTitle>
                  <CardDescription>
                    Publish the lessons to YouTube as a playlist.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-3">
                  <Badge variant={course.status === "published" ? "default" : "secondary"}>
                    {course.status === "published" ? "Published" : "Draft"}
                  </Badge>
                  {course.videos.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {course.videos.length} lesson
                      {course.videos.length === 1 ? "" : "s"} ready to publish.
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <Link
                      href="/courses/new"
                      className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                    >
                      <ArrowLeft className="mr-1 size-4" />
                      All courses
                    </Link>
                    <Button variant="destructive" size="sm" onClick={deleteCourse}>
                      <Trash2 className="mr-1 size-4" />
                      Delete course
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-center">
                <Link
                  href="/videos"
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                >
                  <BookOpen className="mr-1 size-4" />
                  Back to videos
                </Link>
              </div>
            </>
          )}
        </div>
      </AppShell>
    </AuthGuard>
  );
}
