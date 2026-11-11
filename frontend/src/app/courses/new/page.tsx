"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, Loader2, Plus } from "lucide-react";
import { AuthGuard } from "@/components/auth-guard";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth-context";
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
import { LANGUAGES } from "@/lib/languages";
import { cn } from "@/lib/utils";

type VideoRow = {
  _id: string;
  title: string;
  status: string;
  durationSeconds?: number;
  thumbnailUrl?: string | null;
};

type CourseRow = {
  _id: string;
  title: string;
  description?: string;
  language?: string;
  createdAt?: string;
  videos?: { order: number; video: { _id: string; title: string } | null }[];
};

const fieldClass =
  "h-9 w-full rounded-md border-2 border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";

export default function CreateCoursePage() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState(user?.preferences?.defaultLanguage || "ar");
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [videoRes, courseRes] = await Promise.all([
        api.get<{ items: VideoRow[] }>("/api/videos?limit=100"),
        api.get<{ items: CourseRow[] }>("/api/courses"),
      ]);
      if (videoRes.success) setVideos(videoRes.data?.items || []);
      if (courseRes.success) setCourses(courseRes.data?.items || []);
      setLoading(false);
    })();
  }, []);

  const selectedVideos = useMemo(
    () =>
      selected
        .map((id) => videos.find((video) => video._id === id))
        .filter(Boolean) as VideoRow[],
    [selected, videos],
  );

  const toggleVideo = (id: string) => {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  };

  const move = (index: number, direction: -1 | 1) => {
    setSelected((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const createCourse = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      toast.error("A course title is required.");
      return;
    }

    setSaving(true);
    const res = await api.post<{ course: CourseRow }>("/api/courses", {
      title: title.trim(),
      description: description.trim(),
      language,
      videoIds: selected,
    });

    if (res.success && res.data?.course) {
      toast.success("Course created.");
      router.push(`/courses/${res.data.course._id}`);
    } else {
      toast.error(res.message || "Failed to create the course.");
    }
    setSaving(false);
  };

  return (
    <AuthGuard>
      <AppShell
        title="Create Course"
        description="Group your videos into a course you can publish as a playlist"
      >
        <div className="space-y-6">
          <form onSubmit={createCourse} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Course details</CardTitle>
                <CardDescription>
                  The title and description shown to your viewers.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="courseTitle">Title</Label>
                  <Input
                    id="courseTitle"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ethical Hacking from Zero"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="courseDescription">Description</Label>
                  <textarea
                    id="courseDescription"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What will the viewer learn in this course?"
                    className="min-h-24 w-full rounded-md border-2 border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="courseLanguage">Course language</Label>
                  <select
                    id="courseLanguage"
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
                  <p className="text-xs text-muted-foreground">
                    The language the course is taught in.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Lessons</CardTitle>
                <CardDescription>
                  Pick the videos of the course. The order you select them in is
                  the order they are played.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {loading ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : videos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No videos yet. Upload your first video to build a course.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {videos.map((video) => {
                      const index = selected.indexOf(video._id);
                      const isSelected = index !== -1;
                      return (
                        <div
                          key={video._id}
                          className={cn(
                            "flex items-center gap-3 rounded-lg border p-2.5 transition-colors",
                            isSelected
                              ? "border-primary/50 bg-primary/5"
                              : "hover:bg-muted/50",
                          )}
                        >
                          <input
                            type="checkbox"
                            id={`pick-${video._id}`}
                            checked={isSelected}
                            onChange={() => toggleVideo(video._id)}
                            className="size-4 shrink-0 rounded border-slate-300 text-primary focus:ring-primary"
                          />
                          <label
                            htmlFor={`pick-${video._id}`}
                            className="min-w-0 flex-1 cursor-pointer"
                          >
                            <span className="block truncate text-sm font-medium">
                              {video.title || "Untitled video"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {video.status}
                              {video.durationSeconds
                                ? ` • ${Math.round(video.durationSeconds)}s`
                                : ""}
                            </span>
                          </label>
                          {isSelected && (
                            <Badge variant="secondary" className="shrink-0">
                              Lesson {index + 1}
                            </Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {selectedVideos.length > 0 && (
                  <div className="space-y-2 rounded-lg border border-dashed p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Playing order
                    </p>
                    <ol className="space-y-1.5">
                      {selectedVideos.map((video, index) => (
                        <li key={video._id} className="flex items-center gap-2">
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                            {index + 1}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {video.title}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => move(index, -1)}
                            disabled={index === 0}
                            aria-label={`Move ${video.title} up`}
                          >
                            ↑
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => move(index, 1)}
                            disabled={index === selectedVideos.length - 1}
                            aria-label={`Move ${video.title} down`}
                          >
                            ↓
                          </Button>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button type="submit" disabled={saving || !title.trim()}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 size-4" />
                    Create course
                  </>
                )}
              </Button>
            </div>
          </form>

          {courses.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Your courses</CardTitle>
                <CardDescription>
                  {courses.length} course{courses.length === 1 ? "" : "s"} so far.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {courses.map((course) => (
                    <Link
                      key={course._id}
                      href={`/courses/${course._id}`}
                      className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
                    >
                      <BookOpen className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {course.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {course.videos?.length || 0} lesson
                          {(course.videos?.length || 0) === 1 ? "" : "s"} •{" "}
                          {course.language}
                        </p>
                      </div>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-center">
            <Link
              href="/videos"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              Back to videos
            </Link>
          </div>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
