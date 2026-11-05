"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGuard } from "@/components/auth-guard";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/toast-provider";
import { api } from "@/lib/api";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type Chapter = { time: string; title: string };
type AiMetadata = {
  titles?: string[];
  descriptions?: string[];
  tags?: string[];
  chapters?: Chapter[];
  summary?: string;
  keyPoints?: string[];
  actionItems?: string[];
  decisions?: string[];
  openQuestions?: string[];
  model?: string;
};

type VideoDetail = {
  _id: string;
  title: string;
  description?: string;
  status: string;
  currentStage?: string;
  progress?: number;
  publicUrl?: string;
  thumbnailUrl?: string | null;
  mimeType?: string | null;
  durationSeconds?: number;
  transcript?: string;
  transcriptLanguage?: string;
  targetLanguages?: string[];
  originalLanguage?: string;
  youtubeVisibility?: string;
  youtubeCategoryId?: string;
  youtubeVideoId?: string | null;
  youtubeUrl?: string | null;
  lastError?: { message?: string } | null;
  aiMetadata?: AiMetadata | null;
};

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "ru", label: "Russian" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
];

export default function VideoDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();

  const [video, setVideo] = useState<VideoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editVisibility, setEditVisibility] = useState("public");
  const [editCategory, setEditCategory] = useState("27");
  const [editTags, setEditTags] = useState("");

  const load = async () => {
    setLoading(true);
    const res = await api.get<{ video: VideoDetail }>(`/api/videos/${id}`);
    if (res.success && res.data?.video) {
      const v = res.data.video;
      setVideo(v);
      setEditTitle(v.title || "");
      setEditDescription(v.description || "");
      setEditVisibility(v.youtubeVisibility || "public");
      setEditCategory(v.youtubeCategoryId || "27");
      setEditTags(v.aiMetadata?.tags?.join(", ") || "");
    } else {
      toast.error(res.message || "Failed to load video.");
    }
    setLoading(false);
  };

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const saveChanges = async () => {
    if (!video) return;
    setSaving(true);
    const tagList = editTags.split(",").map((t) => t.trim()).filter(Boolean);
    const res = await api.patch<{ video: VideoDetail }>(`/api/videos/${video._id}`, {
      title: editTitle,
      description: editDescription,
      youtubeVisibility: editVisibility,
      youtubeCategoryId: editCategory,
      publishedTags: tagList,
      aiMetadata: { tags: tagList },
    });
    if (res.success && res.data?.video) {
      setVideo(res.data.video);
      toast.success(res.message || "Video updated.");
    } else {
      toast.error(res.message || "Failed to update video.");
    }
    setSaving(false);
  };

  const deleteVideo = async () => {
    if (!video) return;
    if (!window.confirm("Delete this video and its files from Cloudinary?")) return;
    setDeleting(true);
    const res = await api.delete(`/api/videos/${video._id}`);
    if (res.success) {
      toast.success(res.message || "Video deleted.");
      router.push("/dashboard");
    } else {
      toast.error(res.message || "Failed to delete video.");
    }
    setDeleting(false);
  };

  const meta = video?.aiMetadata;

  return (
    <AuthGuard>
      <div className="min-h-screen bg-muted/30">
        <header className="border-b bg-background">
          <div className="mx-auto flex max-w-6xl items-center justify-between p-4">
            <h1 className="text-lg font-semibold">Video details</h1>
            <a href="/dashboard" className="text-sm underline">
              Back
            </a>
          </div>
        </header>

        <main className="mx-auto max-w-6xl p-4 space-y-6">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && !video && <p className="text-sm text-destructive">Video not found.</p>}

          {video && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-4">
                    <span>{video.title}</span>
                    <Badge variant={video.status === "completed" ? "default" : video.status === "failed" ? "destructive" : "secondary"}>
                      {video.status}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    Stage: {video.currentStage || "—"} • Progress {video.progress ?? 0}%
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {video.status === "processing" && <Progress value={video.progress || 0} />}
                  {video.publicUrl && (
                    <div className="space-y-2">
                      <video
                        src={video.publicUrl}
                        controls
                        className="w-full rounded-md border"
                        poster={video.thumbnailUrl || undefined}
                      />
                      {video.durationSeconds ? (
                        <p className="text-xs text-muted-foreground">Duration: {video.durationSeconds}s</p>
                      ) : null}
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="editTitle">Publish title</Label>
                      <Input id="editTitle" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="editDescription">Publish description</Label>
                      <Input
                        id="editDescription"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="editVisibility">Visibility</Label>
                      <select
                        id="editVisibility"
                        value={editVisibility}
                        onChange={(e) => setEditVisibility(e.target.value)}
                        className="w-full h-9 rounded-md border-2 border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                      >
                        <option value="public">Public</option>
                        <option value="unlisted">Unlisted</option>
                        <option value="private">Private</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="editCategory">Category ID</Label>
                      <Input id="editCategory" value={editCategory} onChange={(e) => setEditCategory(e.target.value)} />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="editTags">Tags (comma separated)</Label>
                      <Input id="editTags" value={editTags} onChange={(e) => setEditTags(e.target.value)} />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button onClick={saveChanges} disabled={saving}>
                      {saving ? "Saving…" : "Save publishing details"}
                    </Button>
                    <Button variant="destructive" onClick={deleteVideo} disabled={deleting}>
                      {deleting ? "Deleting…" : "Delete video"}
                    </Button>
                  </div>

                  {video.lastError && (
                    <p className="text-sm text-destructive">Last error: {video.lastError.message}</p>
                  )}
                </CardContent>
              </Card>

              {meta && (
                <Card>
                  <CardHeader>
                    <CardTitle>Generated AI metadata</CardTitle>
                    <CardDescription>{meta.model || "AI model"}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {meta.summary && (
                      <div>
                        <p className="font-medium text-sm">Summary</p>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{meta.summary}</p>
                      </div>
                    )}
                    {meta.titles?.length ? (
                      <div>
                        <p className="font-medium text-sm">Title ideas</p>
                        <ul className="text-sm list-disc pl-5">
                          {meta.titles.map((t, i) => (
                            <li key={i}>{t}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {meta.descriptions?.length ? (
                      <div>
                        <p className="font-medium text-sm">Description options</p>
                        <ul className="text-sm list-disc pl-5">
                          {meta.descriptions.map((d, i) => (
                            <li key={i}>{d}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {meta.tags?.length ? (
                      <div>
                        <p className="font-medium text-sm">Tags</p>
                        <div className="flex flex-wrap gap-1">
                          {meta.tags.map((t, i) => (
                            <Badge key={i} variant="secondary">{t}</Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {meta.chapters?.length ? (
                      <div>
                        <p className="font-medium text-sm">Chapters</p>
                        <ul className="text-sm list-disc pl-5">
                          {meta.chapters.map((c, i) => (
                            <li key={i}>
                              <span className="font-mono text-xs">{c.time}</span> — {c.title}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {meta.keyPoints?.length ? (
                      <div>
                        <p className="font-medium text-sm">Key points</p>
                        <ul className="text-sm list-disc pl-5">
                          {meta.keyPoints.map((p, i) => <li key={i}>{p}</li>)}
                        </ul>
                      </div>
                    ) : null}
                    {meta.actionItems?.length ? (
                      <div>
                        <p className="font-medium text-sm">Action items</p>
                        <ul className="text-sm list-disc pl-5">
                          {meta.actionItems.map((a, i) => <li key={i}>{a}</li>)}
                        </ul>
                      </div>
                    ) : null}
                    {meta.openQuestions?.length ? (
                      <div>
                        <p className="font-medium text-sm">Open questions</p>
                        <ul className="text-sm list-disc pl-5">
                          {meta.openQuestions.map((q, i) => <li key={i}>{q}</li>)}
                        </ul>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              )}

              {video.transcript && (
                <Card>
                  <CardHeader>
                    <CardTitle>Transcript</CardTitle>
                    <CardDescription>{video.transcriptLanguage || video.originalLanguage || "en"}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm whitespace-pre-wrap">{video.transcript}</p>
                  </CardContent>
                </Card>
              )}

              {video.youtubeVideoId && (
                <Card>
                  <CardHeader>
                    <CardTitle>Published to YouTube</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-sm">Video ID: {video.youtubeVideoId}</p>
                    {video.youtubeUrl && (
                      <a href={video.youtubeUrl} target="_blank" rel="noreferrer" className="text-sm underline">
                        Open on YouTube
                      </a>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </main>
      </div>
    </AuthGuard>
  );
}
