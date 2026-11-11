"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { ArrowLeft, BookOpen, ListVideo, Loader2, PlayCircle } from "lucide-react";
import { AuthGuard } from "@/components/auth-guard";
import { AppShell } from "@/components/app-shell";
import { useToast } from "@/components/toast-provider";
import { api } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { languageLabel } from "@/lib/languages";
import { cn } from "@/lib/utils";

type Channel = {
  channelId: string;
  channelTitle?: string | null;
  language?: string | null;
  playlists: {
    id: string;
    title: string;
    description?: string;
    thumbnailUrl?: string | null;
  }[];
};

type CourseRow = {
  _id: string;
  title: string;
  language?: string;
  playlistId?: string | null;
  playlistTitle?: string | null;
  channelId?: string | null;
  status?: string;
  thumbnailUrl?: string | null;
  videos?: { order: number; video: { _id: string; title: string } | null }[];
};

export default function ChannelDetailClient({ id }: { id: string }) {
  
  const toast = useToast();

  const [channel, setChannel] = useState<Channel | null>(null);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [channelRes, courseRes] = await Promise.all([
        api.get<{ channels: Channel[] }>("/api/courses/channels"),
        api.get<{ items: CourseRow[] }>("/api/courses"),
      ]);
      if (channelRes.success) {
        const found = (channelRes.data?.channels || []).find(
          (item) => item.channelId === id,
        );
        setChannel(found || null);
      }
      if (courseRes.success) {
        setCourses(
          (courseRes.data?.items || []).filter(
            (course) => course.channelId === id,
          ),
        );
      }
      setLoading(false);
    })();
  }, [id]);

  return (
    <AuthGuard>
      <AppShell
        title={channel?.channelTitle || "Channel"}
        description={
          channel?.language
            ? `Publishes in ${languageLabel(channel.language)}`
            : undefined
        }
        actions={
          <Link
            href="/channels"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            All channels
          </Link>
        }
      >
        <div className="space-y-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !channel ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-destructive">Channel not found.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ListVideo className="size-4" />
                    Playlists
                  </CardTitle>
                  <CardDescription>
                    Every playlist on this channel. A course gets its own
                    playlist when it is published.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {channel.playlists.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No playlists on this channel yet. Publish a course to
                      create one.
                    </p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {channel.playlists.map((playlist) => {
                        const course = courses.find(
                          (item) => item.playlistId === playlist.id,
                        );
                        return (
                          <div
                            key={playlist.id}
                            className="flex items-start gap-3 rounded-lg border p-3"
                          >
                            {playlist.thumbnailUrl ? (
                              <img
                                src={playlist.thumbnailUrl}
                                alt=""
                                className="size-16 shrink-0 rounded-md object-cover"
                              />
                            ) : (
                              <span className="flex size-16 shrink-0 items-center justify-center rounded-md bg-muted">
                                <ListVideo className="size-5 text-muted-foreground" />
                              </span>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {playlist.title}
                              </p>
                              {playlist.description && (
                                <p className="line-clamp-2 text-xs text-muted-foreground">
                                  {playlist.description}
                                </p>
                              )}
                              {course ? (
                                <Link
                                  href={`/courses/${course._id}`}
                                  className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                >
                                  <BookOpen className="size-3" />
                                  {course.title}
                                </Link>
                              ) : (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  No course linked
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Courses on this channel</CardTitle>
                  <CardDescription>
                    The courses published here, in the language of the channel.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {courses.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No courses on this channel yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {courses.map((course) => (
                        <Link
                          key={course._id}
                          href={`/courses/${course._id}`}
                          className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
                        >
                          {course.thumbnailUrl ? (
                            <img
                              src={course.thumbnailUrl}
                              alt=""
                              className="size-12 shrink-0 rounded-md object-cover"
                            />
                          ) : (
                            <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted">
                              <PlayCircle className="size-5 text-muted-foreground" />
                            </span>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {course.title}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {course.videos?.length || 0} lesson
                              {(course.videos?.length || 0) === 1 ? "" : "s"} •{" "}
                              {languageLabel(course.language)}
                            </p>
                          </div>
                          <Badge
                            variant={
                              course.status === "published" ? "default" : "secondary"
                            }
                          >
                            {course.status === "published" ? "Published" : "Draft"}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="flex flex-wrap justify-between gap-2">
                <Link
                  href="/channels"
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                >
                  <ArrowLeft className="mr-1 size-4" />
                  All channels
                </Link>
                <Link
                  href="/courses/new"
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  <BookOpen className="mr-1 size-4" />
                  Create a course for this channel
                </Link>
              </div>
            </>
          )}
        </div>
      </AppShell>
    </AuthGuard>
  );
}
