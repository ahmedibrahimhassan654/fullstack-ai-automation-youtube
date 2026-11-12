"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ListVideo,
  Loader2,
  PlayCircle,
  Plus,
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
import { Badge } from "@/components/ui/badge";
import { languageLabel } from "@/lib/languages";
import { cn } from "@/lib/utils";

type LessonVersion = {
  source: string;
  url?: string | null;
  voice?: string | null;
};

type CourseLesson = {
  order: number;
  addedAt?: string;
  language?: string | null;
  youtubeVideoId?: string | null;
  youtubeUrl?: string | null;
  publishedAt?: string | null;
  video?: {
    _id: string;
    title: string;
    status: string;
    durationSeconds?: number;
    thumbnailUrl?: string | null;
    dubs?: { language: string; url?: string; voice?: string }[];
    lessonVideos?: {
      language: string;
      source?: string;
      url?: string | null;
      voice?: string | null;
      youtubeVideoId?: string | null;
      youtubeUrl?: string | null;
    }[];
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
  youtubePlaylistId?: string | null;
  youtubePlaylistUrl?: string | null;
  thumbnailUrl?: string | null;
  status?: string;
  createdAt?: string;
  videos?: CourseLesson[];
};

/**
 * Finds the lesson render (dub or study-journey lesson) of a video for a
 * language, the same way the publish service picks the media to upload.
 */
const versionFor = (
  video: CourseLesson["video"],
  language?: string | null,
): LessonVersion | null => {
  const target = String(language || "").trim().toLowerCase();
  const dubs = (video?.dubs || []).filter(
    (dub) => String(dub.language || "").toLowerCase() === target && Boolean(dub.url),
  );
  const lessons = (video?.lessonVideos || []).filter(
    (lesson) =>
      String(lesson.language || "").toLowerCase() === target && Boolean(lesson.url),
  );

  const dub = dubs[0];
  if (dub) {
    return { source: "dub", url: dub.url ?? null, voice: dub.voice ?? null };
  }

  const lesson = lessons[0];
  if (lesson) {
    return {
      source: lesson.source || "lesson",
      url: lesson.url ?? null,
      voice: lesson.voice ?? null,
    };
  }

  return null;
};

export default function CoursesPage() {
  const toast = useToast();

  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsedCourses, setCollapsedCourses] = useState<Record<string, boolean>>({});

  const toggleCourse = (courseId: string) => {
    setCollapsedCourses((current) => ({ ...current, [courseId]: !current[courseId] }));
  };

  const load = async () => {
    const res = await api.get<{ items: Course[] }>("/api/courses");
    if (res.success) {
      setCourses(res.data?.items || []);
    } else {
      toast.error(res.message || "Failed to load the courses.");
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const sortedCourses = useMemo(
    () =>
      [...courses].sort(
        (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
      ),
    [courses],
  );

  return (
    <AuthGuard>
      <AppShell
        title="Courses"
        description="Every course with its YouTube playlist and the lessons published on it."
        actions={
          <Link href="/courses/new" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            <Plus className="mr-2 size-4" />
            New course
          </Link>
        }
      >
        <div className="space-y-6">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading your courses…
            </div>
          ) : sortedCourses.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center">
                <BookOpen className="mx-auto size-8 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">No courses yet.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Group your videos into a course to publish them as one YouTube playlist.
                </p>
                <div className="mt-4 flex justify-center">
                  <Link href="/courses/new" className={cn(buttonVariants({ size: "sm" }))}>
                    <Plus className="mr-2 size-4" />
                    Create your first course
                  </Link>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {sortedCourses.map((course) => {
                const lessons = [...(course.videos || [])].sort(
                  (a, b) => (a.order || 0) - (b.order || 0),
                );
                const publishedCount = lessons.filter(
                  (lesson) => lesson.youtubeUrl || lesson.youtubeVideoId,
                ).length;
                const isCollapsed = Boolean(collapsedCourses[course._id]);

                return (
                  <Card key={course._id}>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        {course.thumbnailUrl ? (
                          <img
                            src={course.thumbnailUrl}
                            alt=""
                            className="size-8 shrink-0 rounded-md object-cover"
                          />
                        ) : (
                          <BookOpen className="size-5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate">{course.title}</span>
                      </CardTitle>
                      <CardDescription>
                        {lessons.length} lesson{lessons.length === 1 ? "" : "s"} •{" "}
                        {languageLabel(course.language)}
                        {course.channelTitle ? ` • ${course.channelTitle}` : ""}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={course.status === "published" ? "default" : "secondary"}
                            className="text-[10px]"
                          >
                            {course.status || "draft"}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {languageLabel(course.language)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {publishedCount} of {lessons.length} published on YouTube
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleCourse(course._id)}
                          className="shrink-0"
                          aria-expanded={!isCollapsed}
                        >
                          {isCollapsed ? (
                            <ChevronDown className="mr-2 size-4" />
                          ) : (
                            <ChevronUp className="mr-2 size-4" />
                          )}
                          {isCollapsed ? "Open" : "Collapse"}
                        </Button>
                      </div>

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
                          {course.playlistId && (
                            <p className="text-xs text-muted-foreground">
                              {course.playlistId}
                            </p>
                          )}
                          {course.youtubePlaylistUrl && (
                            <a
                              href={course.youtubePlaylistUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              <ExternalLink className="size-3" />
                              Open playlist on YouTube
                            </a>
                          )}
                        </div>
                      </div>

                      {lessons.length > 0 &&
                        !isCollapsed &&
                        (
                          <ol className="space-y-2">
                          {lessons.map((entry, index) => {
                            const lessonLanguage = entry.language || course.language;
                            const version = versionFor(entry.video, lessonLanguage);
                            const published = Boolean(entry.youtubeUrl || entry.youtubeVideoId);

                            return (
                              <li
                                key={entry.video?._id || index}
                                className="flex items-start gap-3 rounded-lg border p-3"
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
                                      <span className="truncate">
                                        {entry.video.title || "Untitled video"}
                                      </span>
                                    </Link>
                                  ) : (
                                    <p className="truncate text-sm font-medium">
                                      Removed video
                                    </p>
                                  )}
                                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                    <span>{entry.video?.status || "unknown"}</span>
                                    {version && (
                                      <span>
                                        • {version.source}
                                        {version.voice ? ` • ${version.voice}` : ""}
                                      </span>
                                    )}
                                    {entry.publishedAt && (
                                      <span>
                                        • published{" "}
                                        {new Date(entry.publishedAt).toLocaleDateString()}
                                      </span>
                                    )}
                                    {published && entry.youtubeUrl && (
                                      <a
                                        href={entry.youtubeUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 text-primary hover:underline"
                                      >
                                        <ExternalLink className="size-3" />
                                        Watch on YouTube
                                      </a>
                                    )}
                                  </div>
                                </div>
                                {published ? (
                                  <Badge variant="default" className="shrink-0 text-[10px]">
                                    <Tv className="size-3" />
                                    Published
                                  </Badge>
                                ) : version ? (
                                  <Badge variant="outline" className="shrink-0 text-[10px]">
                                    <ListVideo className="size-3" />
                                    {String(lessonLanguage) || "en"} ready
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                                    Missing {String(lessonLanguage) || "en"} version
                                  </Badge>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                      )}

                      <div className="flex justify-end">
                        <Link
                          href={`/courses/${course._id}`}
                          className={cn(
                            buttonVariants({ variant: "outline", size: "sm" }),
                          )}
                        >
                          Open course
                          <ArrowRight className="ml-2 size-4" />
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-center">
          <Link
            href="/videos"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            <ArrowLeft className="mr-2 size-4" />
            Back to videos
          </Link>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
