'use client';

import Link from 'next/link';
import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { AuthGuard } from '@/components/auth-guard';
import { api } from '@/lib/api';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  const { user } = useAuth();
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const timer = useRef<NodeJS.Timeout | null>(null);

  const load = async () => {
    const r = await api.get<{ items: VideoRow[] }>('/api/videos');
    if (r.success) setVideos((r.data as { items: VideoRow[] }).items || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // Poll while any video is processing, so the loading banner stays live.
    timer.current = setInterval(() => {
      setVideos((prev) => {
        if (prev.some((v) => v.status === 'processing')) {
          load();
        }
        return prev;
      });
    }, 3000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const startProcessing = async (id: string) => {
    await api.post(`/api/videos/${id}/process`);
    await load();
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
                        {STAGE_LABEL[v.currentStage || 'queued'] || v.currentStage}
                      </p>
                    </div>
                    <Progress value={v.progress || 0} />
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
                        <TableCell className="space-x-2">
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