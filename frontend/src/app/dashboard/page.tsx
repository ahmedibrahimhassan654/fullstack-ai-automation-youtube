'use client';

import Link from 'next/link';
import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/toast-provider';
import { AuthGuard } from '@/components/auth-guard';
import { useRouter } from 'next/navigation';
import { api, API_BASE } from '@/lib/api';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trash2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

type VideoRow = {
  _id: string;
  title: string;
  status: string;
  currentStage?: string;
  progress?: number;
  durationSeconds?: number;
  createdAt?: string;
  publicUrl?: string;
  transcript?: string;
  lastError?: { message?: string } | null;
  originalLanguage?: string;
  transcriptLanguage?: string;
  targetLanguages?: string[];
  translations?: { language: string }[];
  dubs?: { language: string }[];
  lessonVideos?: {
    language: string;
    source?: 'lesson' | 'dub';
    youtubeUrl?: string | null;
    youtubeVideoId?: string | null;
    youtubeChannelTitle?: string | null;
  }[];
};

const STAGE_LABEL: Record<string, string> = {
  queued: 'Queued for processing',
  transcription: 'Transcribing audio with Whisper (speech-to-text)...',
  transcribed: 'Transcription complete. Preparing AI metadata...',
  analysis: 'Generating titles, chapters, tags and descriptions with AI...',
  analyzed: 'AI metadata ready. Preparing translations...',
  translation: 'Translating transcript to target languages...',
  translated: 'Translations ready. Preparing YouTube publishing...',
  publishing: 'Publishing to your YouTube channel...',
  published: 'Published to YouTube.',
  completed: 'Completed',
  failed: 'Processing failed',
};

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    const r = await api.get<{ items: VideoRow[] }>('/api/videos');
    if (r.success) setVideos((r.data as { items: VideoRow[] }).items || []);
    else toast.error(r.message || 'Failed to load videos.');
    setLoading(false);
  };

  useEffect(() => {
    load();

    const token = api.getToken();
    if (!token) return;

    const es = new EventSource(`${API_BASE}/api/events?token=${encodeURIComponent(token)}`);
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "connected") return;
        setVideos((prev) =>
          prev.map((video) =>
            video._id === data.videoId
              ? {
                  ...video,
                  status: data.status ?? video.status,
                  currentStage: data.currentStage ?? video.currentStage,
                  progress: data.progress ?? video.progress,
                  lastError: data.lastError ?? video.lastError,
                }
              : video,
          ),
        );
      } catch {
        // ignore malformed events
      }
    };
    return () => es.close();
  }, []);

  const startProcessing = async (id: string) => {
    const response = await api.post(`/api/videos/${id}/process`);
    if (response.success) {
      toast.success(response.message || "Processing started.");
    } else {
      toast.error(response.message || "Failed to start processing.");
    }
    await load();
  };

  const deleteVideo = async (id: string) => {
    if (!window.confirm("Delete this video and all generated files?")) return;
    const res = await api.delete(`/api/videos/${id}`);
    if (res.success) {
      toast.success(res.message || "Video deleted.");
      await load();
    } else {
      toast.error(res.message || "Failed to delete video.");
    }
  };

  const cancelProcessing = async (id: string) => {
    if (!window.confirm("Cancel processing for this video?")) return;
    const res = await api.post(`/api/videos/${id}/cancel`);
    if (res.success) {
      toast.success(res.message || "Processing cancelled.");
      await load();
    } else {
      toast.error(res.message || "Failed to cancel processing.");
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      toast.success("Logged out successfully.");
      router.push("/login");
    } catch (err) {
      toast.error("Logout failed. Please try again.");
    }
  };

  const processingVideos = videos.filter((v) => v.status === 'processing');

  return (
    <AuthGuard>
      <div className="min-h-screen bg-muted/30">
        <header className="border-b bg-background">
          <div className="mx-auto flex max-w-6xl items-center justify-between p-4">
            <h1 className="text-lg font-semibold">AI YouTube Automation</h1>
            <nav className="flex items-center gap-4">
              <Link href="/settings" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
                Settings
              </Link>
              {user?.role === 'admin' && (
                <Link href="/admin" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
                  Admin
                </Link>
              )}
              <Button variant="outline" size="sm" onClick={handleLogout}>
                Log out
              </Button>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-6xl p-4 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">Welcome, {user?.name}</h2>
              <p className="text-muted-foreground">Your videos and processing status</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{user?.subscription?.plan || 'free'}</Badge>
              <Link href="/videos/new" className={cn(buttonVariants())}>
                New upload
              </Link>
            </div>
          </div>

          {/* Loading banner for in-progress work */}
          {processingVideos.length > 0 && (
            <Card className="border-primary/40 bg-primary/5">
              <CardHeader>
                <CardTitle className="text-base">Processing in progress</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {processingVideos.map((v) => (
                  <div key={v._id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">{v.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {STAGE_LABEL[v.currentStage || 'queued'] || v.currentStage} • {v.progress ?? 0}%
                      </p>
                    </div>
                    <Progress value={v.progress || 0} />
                    {v.lastError?.message && (
                      <p className="text-xs text-destructive">{v.lastError.message}</p>
                    )}
                    {v.transcript && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground">Transcript (preview)</summary>
                        <p className="mt-1 whitespace-pre-wrap line-clamp-6">{v.transcript.slice(0, 600)}...</p>
                      </details>
                    )}
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  You can leave this page; processing continues on the server. This banner updates automatically.
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Videos</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : videos.length === 0 ? (
                <p className="text-sm text-muted-foreground">No videos yet. Upload your first video.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead>Progress</TableHead>
                      <TableHead>Languages</TableHead>
                        <TableHead>YouTube (lesson links)</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {videos.map((v) => (
                      <TableRow key={v._id}>
                        <TableCell className="font-medium">{v.title}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              v.status === 'completed'
                                ? 'default'
                                : v.status === 'failed'
                                ? 'destructive'
                                : 'secondary'
                            }
                          >
                            {v.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {STAGE_LABEL[v.currentStage || ''] || v.currentStage || '—'}
                        </TableCell>
                        <TableCell>
                          {v.status === 'processing' ? (
                            <Progress value={v.progress || 0} className="h-2 w-24" />
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="text-xs space-y-1">
                          <div>
                            Original: {v.transcriptLanguage || v.originalLanguage || '—'}
                          </div>
                          <div>
                            Targets: {v.targetLanguages?.length ? v.targetLanguages.join(', ') : '—'}
                          </div>
                          {v.translations?.length ? (
                            <div>
                              Translated: {v.translations.map((t) => t.language).join(', ')}
                            </div>
                          ) : null}
                          {v.lessonVideos?.filter((l) => (l.source ?? 'lesson') === 'lesson').length ? (
                            <div>
                              Lesson renders: {v.lessonVideos.filter((l) => (l.source ?? 'lesson') === 'lesson').map((l) => l.language).join(', ')}
                            </div>
                          ) : null}
                          {v.dubs?.length ? (
                            <div>Dubs: {v.dubs.map((d) => d.language).join(', ')}</div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs space-y-1">
                          {(v.lessonVideos || [])
                            .filter((l) => l.youtubeUrl || l.youtubeVideoId)
                            .map((l, i) => (
                              <div key={i}>
                                {l.youtubeUrl ? (
                                  <a href={l.youtubeUrl} target="_blank" rel="noreferrer" className="underline">
                                    {l.language} ({l.source === 'dub' ? 'dub' : 'lesson'}) → YouTube
                                  </a>
                                ) : (
                                  `${l.language} (${l.source === 'dub' ? 'dub' : 'lesson'}) (published)`
                                )}
                                {l.youtubeChannelTitle ? ` • ${l.youtubeChannelTitle}` : ""}
                              </div>
                            ))}
                          {!(v.lessonVideos || []).some((l) => l.youtubeUrl || l.youtubeVideoId) && "—"}
                        </TableCell>
                        <TableCell className="space-x-2">
                          <a href={`/videos/${v._id}`} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
                            Details
                          </a>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteVideo(v._id)}
                            className="text-destructive hover:text-destructive"
                            title="Delete video"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          {v.status === "processing" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => cancelProcessing(v._id)}
                              title="Cancel processing"
                            >
                              Cancel
                            </Button>
                          )}
                          {v.status === 'pending' && (
                            <Button size="sm" onClick={() => startProcessing(v._id)}>
                              Process
                            </Button>
                          )}
                          {v.status === 'failed' && (
                            <Button size="sm" variant="outline" onClick={() => startProcessing(v._id)}>
                              Retry
                            </Button>
                          )}
                          {v.lastError && (
                            <span className="text-xs text-destructive" title={v.lastError.message}>
                              !
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </AuthGuard>
  );
}