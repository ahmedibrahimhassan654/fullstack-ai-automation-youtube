'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AuthGuard } from '@/components/auth-guard';
import { AppShell } from '@/components/app-shell';
import { useToast } from '@/components/toast-provider';
import { api } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { BarChart3, CheckCircle2, ExternalLink, RefreshCw, TriangleAlert, Tv, Video } from 'lucide-react';
import { cn } from '@/lib/utils';

type SeoCheck = { ok: boolean; points: number; label: string; tip: string; value?: any };
type SeoInfo = { score: number; level: 'strong' | 'good' | 'fair' | 'weak'; checks: SeoCheck[]; tips: string[] };
type SeoVideo = {
  courseId: string;
  courseTitle: string;
  videoId: string | null;
  sourceTitle: string | null;
  order: number | null;
  durationSeconds: number;
  language: string;
  title: string;
  description: string;
  tags: string[];
  chapters: any[];
  thumbnailUrl: string | null;
  youtubeUrl: string | null;
  published: boolean;
  hasDub: boolean;
  hasLessonRender: boolean;
  seo: SeoInfo;
};
type SeoCourse = { _id: string; title: string; language?: string | null; status?: string; videos: SeoVideo[]; summary: Summary };
type Summary = { count: number; avgScore: number; published: number; strong: number; needsWork: number; courses?: number };
type SeoChannel = { channelId: string; channelTitle?: string | null; language?: string | null; playlistsCount: number; courses: SeoCourse[]; summary: Summary };
type SeoOverview = { generatedAt: string; note: string; overall: Summary; channels: SeoChannel[]; unassignedCourses: SeoCourse[] };

const levelLabel: Record<string, string> = { strong: 'Strong', good: 'Good', fair: 'Fair', weak: 'Weak' };
const levelClass: Record<string, string> = {
  strong: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  good: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30',
  fair: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  weak: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30',
};

function ScoreBadge({ seo }: { seo: SeoInfo }) {
  return (
    <Badge variant="outline" className={cn('font-semibold', levelClass[seo.level])}>
      {seo.score}/100 · {levelLabel[seo.level]}
    </Badge>
  );
}

function SummaryCards({ summary, title }: { summary: Summary; title: string }) {
  const items = [
    { label: 'Videos', value: summary.count },
    { label: 'Avg SEO', value: `${summary.avgScore}/100` },
    { label: 'Published', value: summary.published },
    { label: 'Strong', value: summary.strong },
    { label: 'Need work', value: summary.needsWork },
  ];
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {items.map((it) => (
          <div key={it.label} className="rounded-lg border bg-card px-3 py-2">
            <div className="text-lg font-semibold leading-tight">{it.value}</div>
            <div className="text-xs text-muted-foreground">{it.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VideoSeoRow({ v }: { v: SeoVideo }) {
  const [open, setOpen] = useState(false);
  const displayTitle = v.title || v.sourceTitle || 'Untitled video';
  const failed = v.seo.checks.filter((c) => !c.ok);
  return (
    <div className="rounded-lg border bg-card/50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-col gap-2 p-3 text-left sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium" title={displayTitle}>{displayTitle}</span>
            {v.language && <Badge variant="secondary">{v.language}</Badge>}
            {v.published ? <Badge variant="outline" className="border-emerald-500/30 text-emerald-700 dark:text-emerald-400">Published</Badge> : <Badge variant="outline">Not published</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {v.courseTitle && <span>Course: {v.courseTitle}</span>}
            {v.order != null && <span>Lesson #{v.order + 1}</span>}
            <span>{v.tags.length} tags</span>
            <span>{v.description ? `${v.description.split(/\s+/).filter(Boolean).length} desc words` : 'No description'}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden w-28 sm:block"><Progress value={v.seo.score} className="h-2" /></div>
          <ScoreBadge seo={v.seo} />
        </div>
      </button>
      {open && (
        <div className="space-y-3 border-t p-3">
          <div className="flex flex-wrap gap-2">
            {v.youtubeUrl && (
              <a href={v.youtubeUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <ExternalLink className="size-3" /> Open on YouTube
              </a>
            )}
            {v.videoId && (
              <>
                <Link href={`/videos/${v.videoId}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  <Video className="size-3" /> Open video
                </Link>
                <Link
                  href={`/videos/${v.videoId}/publish?language=${encodeURIComponent(v.language || 'en')}`}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <BarChart3 className="size-3" /> صفحة ما قبل النشر (Publish review)
                </Link>
              </>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs font-medium">Checks</p>
              <ul className="space-y-1">
                {v.seo.checks.map((c, i) => (
                  <li key={i} className={cn('flex items-start gap-2 text-xs', c.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400')}>
                    {c.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> : <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />}
                    <span>
                      <span className="font-medium">{c.label}</span>
                      {c.value !== null && c.value !== undefined && c.value !== '' ? <span className="text-muted-foreground"> — {String(c.value).slice(0, 80)}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium">How to improve</p>
              {failed.length === 0 ? (
                <p className="text-xs text-emerald-700 dark:text-emerald-400">Looks strong. Keep titles/descriptions/tags relevant to what viewers search for.</p>
              ) : (
                <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                  {failed.map((c, i) => <li key={i}>{c.tip}</li>)}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ChannelBlock({ channel }: { channel: SeoChannel }) {
  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 text-white"><Tv className="size-4" /></span>
              {channel.channelTitle || channel.channelId}
            </CardTitle>
            <CardDescription>
              {channel.language ? `Language: ${channel.language}` : 'No language set'} · {channel.summary.courses || 0} course(s) · {channel.playlistsCount} playlist(s)
            </CardDescription>
          </div>
          <Badge variant="outline" className={cn('text-sm', levelClass[channel.summary.avgScore >= 80 ? 'strong' : channel.summary.avgScore >= 55 ? 'good' : channel.summary.avgScore >= 35 ? 'fair' : 'weak'])}>
            Avg {channel.summary.avgScore}/100
          </Badge>
        </div>
        <SummaryCards summary={channel.summary} title="Channel SEO summary" />
      </CardHeader>
      <CardContent className="space-y-4">
        {channel.courses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No courses/videos found for this channel yet.</p>
        ) : (
          channel.courses.map((course) => (
            <div key={course._id} className="space-y-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{course.title}</p>
                  {course.language && <Badge variant="secondary">{course.language}</Badge>}
                  {course.status && <Badge variant="outline">{course.status}</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">Avg {course.summary.avgScore}/100 · {course.summary.count} video(s)</div>
              </div>
              {course.videos.length === 0 ? (
                <p className="text-sm text-muted-foreground">No videos in this course.</p>
              ) : (
                <div className="space-y-2">
                  {course.videos.map((v, idx) => <VideoSeoRow key={`${v.videoId || v.courseId}-${idx}`} v={v} />)}
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export default function SeoPage() {
  const toast = useToast();
  const [data, setData] = useState<SeoOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState('');

  const load = async (soft = false) => {
    if (soft) setRefreshing(true); else setLoading(true);
    const res = await api.get<SeoOverview>('/api/seo/overview');
    if (res.success && res.data) setData(res.data as SeoOverview);
    else toast.error(res.message || 'Failed to load SEO overview.');
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const courseOptions = useMemo(() => {
    const allCourses = [
      ...(data?.channels || []).flatMap((ch) => ch.courses || []),
      ...(data?.unassignedCourses || []),
    ];
    const byId = new Map<string, SeoCourse>();
    for (const c of allCourses) {
      if (c?._id && !byId.has(c._id)) byId.set(c._id, c);
    }
    return Array.from(byId.values()).sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  }, [data]);

  const channels = useMemo(() => {
    const all = data?.channels || [];
    if (!selectedCourseId) return all;
    return all
      .map((ch) => ({
        ...ch,
        courses: (ch.courses || []).filter((c) => c._id === selectedCourseId),
      }))
      .filter((ch) => (ch.courses || []).length > 0);
  }, [data, selectedCourseId]);
  const unassigned = useMemo(() => {
    const all = data?.unassignedCourses || [];
    if (!selectedCourseId) return all;
    return all.filter((c) => c._id === selectedCourseId);
  }, [data, selectedCourseId]);

  return (
    <AuthGuard>
      <AppShell
        title="SEO"
        description="SEO strength overview for your channels and every video in them (metadata-based)"
        actions={
          <Button variant="outline" size="sm" onClick={() => load(true)} disabled={loading || refreshing}>
            <RefreshCw className={cn('mr-2 size-4', refreshing && 'animate-spin')} /> Refresh
          </Button>
        }
      >
        <div className="space-y-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading SEO overview…</p>
          ) : !data ? (
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">No SEO data available.</p></CardContent></Card>
          ) : (
            <>
              <Card>
                <CardHeader className="space-y-3">
                  <CardTitle className="flex items-center gap-2"><BarChart3 className="size-5" /> Overall</CardTitle>
                  <CardDescription>{data.note}</CardDescription>
                  <div className="max-w-md">
                    <select
                      value={selectedCourseId}
                      onChange={(e) => setSelectedCourseId(e.target.value)}
                      className="h-9 w-full rounded-md border-2 border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    >
                      <option value="">كل الكورسات</option>
                      {courseOptions.map((c) => (
                        <option key={c._id} value={c._id}>
                          {c.title}{c.language ? ` — ${c.language}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedCourseId && (
                    <p className="text-xs text-muted-foreground">
                      عرض كورس محدد: {courseOptions.find((c) => c._id === selectedCourseId)?.title || selectedCourseId}
                    </p>
                  )}
                </CardHeader>
                <CardContent className="space-y-2">
                  <SummaryCards summary={data.overall} title="All analyzed videos" />
                  <p className="text-xs text-muted-foreground">Generated at {new Date(data.generatedAt).toLocaleString()}</p>
                </CardContent>
              </Card>

              {channels.length === 0 ? (
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-muted-foreground">
                      {selectedCourseId ? 'لا يوجد كورس مطابق في القنوات المتصلة.' : 'No connected YouTube channels found. Connect a channel in Settings/Courses to see channel-level SEO.'}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-6">
                  {channels.map((ch) => <ChannelBlock key={ch.channelId} channel={ch} />)}
                </div>
              )}

              {unassigned.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Courses not linked to a connected channel</CardTitle>
                    <CardDescription>These courses/videos are still analyzed so you can improve their SEO metadata.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {unassigned.map((course) => (
                      <div key={course._id} className="space-y-2 rounded-lg border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">{course.title}</p>
                            {course.language && <Badge variant="secondary">{course.language}</Badge>}
                          </div>
                          <div className="text-xs text-muted-foreground">Avg {course.summary.avgScore}/100 · {course.summary.count} video(s)</div>
                        </div>
                        <div className="space-y-2">
                          {course.videos.map((v, idx) => <VideoSeoRow key={`${v.videoId || v.courseId}-${idx}`} v={v} />)}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </AppShell>
    </AuthGuard>
  );
}
