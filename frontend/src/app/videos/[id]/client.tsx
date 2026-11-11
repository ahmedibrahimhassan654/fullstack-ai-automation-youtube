"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGuard } from "@/components/auth-guard";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/toast-provider";
import { Loader2 } from "lucide-react";
import { api, API_BASE } from "@/lib/api";
import { Button, buttonVariants } from "@/components/ui/button";
import LessonVideoCard from "./lesson-card";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type Chapter = { time: string; title: string };
type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
  sourceText?: string;
  qualityScore?: number | null;
  qualityStatus?: "passed" | "failed" | "unknown";
  qualityReason?: string;
  translationAttempts?: number;
  wordSuggestions?: { english: string; equivalent: string }[];
};
type Translation = {
  language: string;
  transcript?: string;
  segments?: TranscriptSegment[];
  qualityScore?: number | null;
  qualityStatus?: "passed" | "failed" | "unknown";
  translationAttempts?: number;
};
type Dub = { language: string; url: string; voice?: string; durationSeconds?: number; subtitlesBurned?: boolean; createdAt?: string };
type DubbingState = { language?: string | null; status?: "idle" | "processing" | "completed" | "failed"; progress?: number; error?: string | null } | null;
type LessonVideo = { language: string; source?: "lesson" | "dub"; url: string; voice?: string; durationSeconds?: number; script?: string; createdAt?: string };
type LessonGenerationState = { language?: string | null; status?: "idle" | "processing" | "completed" | "failed"; progress?: number; error?: string | null } | null;
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
  transcriptSegments?: TranscriptSegment[];
  transcriptLanguage?: string;
  translations?: Translation[];
  targetLanguages?: string[];
  originalLanguage?: string;
  attachments?: { name?: string; type?: string; url?: string | null }[];
  youtubeVisibility?: string;
  youtubeCategoryId?: string;
  youtubeVideoId?: string | null;
  youtubeUrl?: string | null;
  lastError?: { message?: string } | null;
  dubs?: Dub[];
  dubbing?: DubbingState;
  lessonVideos?: LessonVideo[];
  lessonGeneration?: LessonGenerationState;
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedLanguage, setSelectedLanguage] = useState("");
  const [dubLanguage, setDubLanguage] = useState("");
  const [generatingDub, setGeneratingDub] = useState(false);
  const [edgeVoiceOptionsByLang, setEdgeVoiceOptionsByLang] = useState<Record<string, string[]>>({});
  const [dubEdgeVoice, setDubEdgeVoice] = useState("");
  const [deletingDubKey, setDeletingDubKey] = useState<string | null>(null);

  // Study-journey lesson render is a separate product from dubbing, so it keeps
  // its own language / voice selection state.
  const [lessonLanguage, setLessonLanguage] = useState("");
  const [generatingLesson, setGeneratingLesson] = useState(false);
  const [lessonEdgeVoice, setLessonEdgeVoice] = useState("");
  const [lessonVoiceId, setLessonVoiceId] = useState("");
  const [elevenVoices, setElevenVoices] = useState<{ voice_id: string; name: string }[]>([]);

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
      setSelectedLanguage(v.transcriptLanguage || v.originalLanguage || "en");
      setDubLanguage(v.targetLanguages?.[0] || v.transcriptLanguage || v.originalLanguage || "en");
      setLessonLanguage(v.targetLanguages?.[0] || v.transcriptLanguage || v.originalLanguage || "en");
    } else {
      toast.error(res.message || "Failed to load video.");
    }
    setLoading(false);
  };

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    api.get<{ voices: { voice_id: string; name: string }[] }>("/api/videos/voices").then((res) => {
      if (res.success && res.data?.voices) setElevenVoices(res.data.voices);
    });
  }, []);

  useEffect(() => {
    api.get<{ voices: Record<string, string[]> }>("/api/videos/edge-voices").then((res) => {
      if (res.success && res.data?.voices) setEdgeVoiceOptionsByLang(res.data.voices);
    });
  }, []);

  useEffect(() => {
    const opts = edgeVoiceOptionsByLang[dubLanguage] || edgeVoiceOptionsByLang[video?.transcriptLanguage || video?.originalLanguage || "en"] || [];
    if (opts.length && !opts.includes(dubEdgeVoice)) setDubEdgeVoice(opts[0]);
  }, [dubLanguage, edgeVoiceOptionsByLang, dubEdgeVoice, video?.transcriptLanguage, video?.originalLanguage]);

  useEffect(() => {
    const opts = edgeVoiceOptionsByLang[lessonLanguage] || edgeVoiceOptionsByLang[video?.transcriptLanguage || video?.originalLanguage || "en"] || [];
    if (opts.length && !opts.includes(lessonEdgeVoice)) setLessonEdgeVoice(opts[0]);
  }, [lessonLanguage, edgeVoiceOptionsByLang, lessonEdgeVoice, video?.transcriptLanguage, video?.originalLanguage]);

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

  // Real-time updates via SSE instead of polling.
  useEffect(() => {
    const token = api.getToken();
    if (!id || !token) return;

    const es = new EventSource(`${API_BASE}/api/videos/${id}/events?token=${encodeURIComponent(token)}`);
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "connected") return;

        if (data.dubbing?.status && data.dubbing.status !== "processing" && prevDubbingStatus.current === "processing") {
          if (data.dubbing.status === "completed") {
            toast.success(`Dubbed video ready in ${data.dubbing.language}.`);
          } else if (data.dubbing.status === "failed") {
            toast.error(data.dubbing.error || "Dubbing failed.");
          }
        }
        if (data.lessonGeneration?.status && data.lessonGeneration.status !== "processing" && prevLessonStatus.current === "processing") {
          if (data.lessonGeneration.status === "completed") {
            toast.success(`Generated lesson video ready in ${data.lessonGeneration.language}.`);
          } else if (data.lessonGeneration.status === "failed") {
            toast.error(data.lessonGeneration.error || "Lesson generation failed.");
          }
        }

        prevDubbingStatus.current = data.dubbing?.status ?? prevDubbingStatus.current;
        prevLessonStatus.current = data.lessonGeneration?.status ?? prevLessonStatus.current;

        setVideo((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            status: data.status ?? prev.status,
            currentStage: data.currentStage ?? prev.currentStage,
            progress: data.progress ?? prev.progress,
            lastError: data.lastError ?? prev.lastError,
            dubbing: data.dubbing ?? prev.dubbing,
            lessonGeneration: data.lessonGeneration ?? prev.lessonGeneration,
            dubs: data.dubs ?? prev.dubs,
            lessonVideos: data.lessonVideos ?? prev.lessonVideos,
            transcript: data.transcript ?? prev.transcript,
            transcriptSegments: data.transcriptSegments ?? prev.transcriptSegments,
            translations: data.translations ?? prev.translations,
            aiMetadata: data.aiMetadata ?? prev.aiMetadata,
          };
        });
      } catch {
        // ignore malformed events
      }
    };
    return () => es.close();
  }, [id]);

  const meta = video?.aiMetadata;

  const prevDubbingStatus = useRef<string | null>(null);
  const prevLessonStatus = useRef<string | null>(null);

  useEffect(() => {
    if (video) {
      prevDubbingStatus.current = video.dubbing?.status ?? null;
      prevLessonStatus.current = video.lessonGeneration?.status ?? null;
    }
  }, [video?._id]);

  const availableLanguages = video
    ? (() => {
        const map = new Map<string, { code: string; label: string; segments: TranscriptSegment[]; text: string }>();
        const primaryCode = video.transcriptLanguage || video.originalLanguage || "en";
        map.set(primaryCode, {
          code: primaryCode,
          label: LANGUAGES.find((l) => l.code === primaryCode)?.label || primaryCode,
          segments: video.transcriptSegments || [],
          text: video.transcript || "",
        });
        for (const translation of video.translations || []) {
          map.set(translation.language, {
            code: translation.language,
            label: LANGUAGES.find((l) => l.code === translation.language)?.label || translation.language,
            segments: translation.segments || [],
            text: translation.transcript || "",
          });
        }
        return [...map.values()];
      })()
    : [];
  const selectedLanguageData =
    availableLanguages.find((l) => l.code === selectedLanguage) || availableLanguages[0];

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    const onTimeUpdate = () => setCurrentTime(element.currentTime);
    element.addEventListener("timeupdate", onTimeUpdate);
    return () => element.removeEventListener("timeupdate", onTimeUpdate);
  }, [video]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Every generated dub is grouped under its language so multiple voices per
  // language stay organised.
  const dubGroups = Object.values(
    (video?.dubs || []).reduce<Record<string, Dub[]>>((acc, dub) => {
      if (!acc[dub.language]) acc[dub.language] = [];
      acc[dub.language].push(dub);
      return acc;
    }, {}),
  );

  return (
    <AuthGuard>
      <AppShell
        title="Video details"
        description={video?.title || undefined}
        contentClassName="max-w-6xl"
      >
        <div className="space-y-6">
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
                        ref={videoRef}
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

              {video.attachments?.length ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Attachments & links</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm">
                      {video.attachments.map((a, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">{a.type || "file"}</Badge>
                          {a.url ? (
                            <a href={a.url} target="_blank" rel="noreferrer" className="underline">
                              {a.name || a.url}
                            </a>
                          ) : (
                            <span className="text-muted-foreground">{a.name || "Unavailable"}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ) : null}

              {meta && (
                <Card>
                  <CardHeader>
                    <CardTitle>Generated AI metadata</CardTitle>
                    <CardDescription>{meta.model || "AI model"}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Tabs defaultValue="summary" className="w-full">
                      <TabsList className="flex h-auto w-full flex-wrap gap-1">
                        <TabsTrigger value="summary">Summary</TabsTrigger>
                        {meta.titles?.length ? <TabsTrigger value="titles">Titles</TabsTrigger> : null}
                        {meta.descriptions?.length ? <TabsTrigger value="descriptions">Descriptions</TabsTrigger> : null}
                        {meta.tags?.length ? <TabsTrigger value="tags">Tags</TabsTrigger> : null}
                        {meta.chapters?.length ? <TabsTrigger value="chapters">Chapters</TabsTrigger> : null}
                        {meta.keyPoints?.length ? <TabsTrigger value="keyPoints">Key points</TabsTrigger> : null}
                        {meta.actionItems?.length ? <TabsTrigger value="actions">Actions</TabsTrigger> : null}
                        {meta.decisions?.length ? <TabsTrigger value="decisions">Decisions</TabsTrigger> : null}
                        {meta.openQuestions?.length ? <TabsTrigger value="questions">Questions</TabsTrigger> : null}
                      </TabsList>

                      <TabsContent value="summary" className="mt-4">
                        {meta.summary ? (
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{meta.summary}</p>
                        ) : (
                          <p className="text-sm text-muted-foreground">No summary.</p>
                        )}
                      </TabsContent>

                      {meta.titles?.length ? (
                        <TabsContent value="titles" className="mt-4">
                          <ul className="text-sm list-disc pl-5 space-y-1">
                            {meta.titles.map((t, i) => (
                              <li key={i}>{t}</li>
                            ))}
                          </ul>
                        </TabsContent>
                      ) : null}

                      {meta.descriptions?.length ? (
                        <TabsContent value="descriptions" className="mt-4">
                          <ul className="text-sm list-disc pl-5 space-y-1">
                            {meta.descriptions.map((d, i) => (
                              <li key={i}>{d}</li>
                            ))}
                          </ul>
                        </TabsContent>
                      ) : null}

                      {meta.tags?.length ? (
                        <TabsContent value="tags" className="mt-4">
                          <div className="flex flex-wrap gap-1">
                            {meta.tags.map((t, i) => (
                              <Badge key={i} variant="secondary">{t}</Badge>
                            ))}
                          </div>
                        </TabsContent>
                      ) : null}

                      {meta.chapters?.length ? (
                        <TabsContent value="chapters" className="mt-4">
                          <ul className="text-sm list-disc pl-5 space-y-1">
                            {meta.chapters.map((c, i) => (
                              <li key={i}>
                                <span className="font-mono text-xs">{c.time}</span> — {c.title}
                              </li>
                            ))}
                          </ul>
                        </TabsContent>
                      ) : null}

                      {meta.keyPoints?.length ? (
                        <TabsContent value="keyPoints" className="mt-4">
                          <ul className="text-sm list-disc pl-5 space-y-1">
                            {meta.keyPoints.map((p, i) => <li key={i}>{p}</li>)}
                          </ul>
                        </TabsContent>
                      ) : null}

                      {meta.actionItems?.length ? (
                        <TabsContent value="actions" className="mt-4">
                          <ul className="text-sm list-disc pl-5 space-y-1">
                            {meta.actionItems.map((a, i) => <li key={i}>{a}</li>)}
                          </ul>
                        </TabsContent>
                      ) : null}

                      {meta.decisions?.length ? (
                        <TabsContent value="decisions" className="mt-4">
                          <ul className="text-sm list-disc pl-5 space-y-1">
                            {meta.decisions.map((d, i) => <li key={i}>{d}</li>)}
                          </ul>
                        </TabsContent>
                      ) : null}

                      {meta.openQuestions?.length ? (
                        <TabsContent value="questions" className="mt-4">
                          <ul className="text-sm list-disc pl-5 space-y-1">
                            {meta.openQuestions.map((q, i) => <li key={i}>{q}</li>)}
                          </ul>
                        </TabsContent>
                      ) : null}
                    </Tabs>
                  </CardContent>
                </Card>
              )}


              <Card>
                <CardHeader>
                  <CardTitle>Dubbed original video</CardTitle>
                  <CardDescription>
                    Replace the original video's audio with a synchronized dubbed track while keeping the original footage and timing.
                    This is the video you publish to YouTube for the target language.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor="dubLanguage">Dub language</Label>
                    <select
                      id="dubLanguage"
                      value={dubLanguage}
                      onChange={(e) => setDubLanguage(e.target.value)}
                      className="h-9 rounded-md border-2 border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    >
                      {[...(video.targetLanguages || []), video.transcriptLanguage || video.originalLanguage || "en"]
                        .filter((value, index, array) => value && array.indexOf(value) === index)
                        .map((code) => (
                          <option key={code} value={code}>
                            {LANGUAGES.find((l) => l.code === code)?.label || code} ({code})
                          </option>
                        ))}
                    </select>
                    <div className="flex items-center gap-2">
                      <Label htmlFor="dubEdgeVoice">Dub voice</Label>
                      <select
                        id="dubEdgeVoice"
                        value={dubEdgeVoice}
                        onChange={(e) => setDubEdgeVoice(e.target.value)}
                        className="h-9 rounded-md border-2 border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                      >
                        {(edgeVoiceOptionsByLang[dubLanguage] || []).map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    </div>
                    <Button
                      onClick={async () => {
                        setGeneratingDub(true);
                        const res = await api.post<{ video: VideoDetail }>(`/api/videos/${video._id}/dub`, { language: dubLanguage, voice: dubEdgeVoice });
                        if (res.success) {
                          toast.success(res.message || "Dubbing started.");
                          if (res.data?.video) setVideo(res.data.video);
                        } else {
                          toast.error(res.message || "Failed to start dubbing.");
                        }
                        setGeneratingDub(false);
                      }}
                      disabled={generatingDub || video.dubbing?.status === "processing"}
                    >
                      {video.dubbing?.status === "processing" ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {`Dubbing… ${video.dubbing.progress ?? 0}%`}
                        </>
                      ) : generatingDub ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Starting…
                        </>
                      ) : (
                        "Dub original video"
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={async () => {
                        const res = await api.post<{ video: VideoDetail }>(
                          `/api/videos/${video._id}/translate`,
                          { language: dubLanguage },
                        );
                        if (res.success) {
                          toast.success(
                            res.message || "Translated transcript updated.",
                          );
                          if (res.data?.video) setVideo(res.data.video);
                        } else {
                          toast.error(
                            res.message || "Failed to update translated transcript.",
                          );
                        }
                      }}
                      disabled={video.dubbing?.status === "processing"}
                    >
                      Refresh translation ({dubLanguage})
                    </Button>
                  </div>
                  {video.dubbing?.status === "processing" && (
                    <Progress value={video.dubbing.progress || 0} className="h-2" />
                  )}
                  {video.dubbing?.status === "processing" && (
                    <Button variant="destructive" size="sm" onClick={async () => {
                      const res = await api.post<{ video: VideoDetail }>(`/api/videos/${video._id}/dub/cancel`);
                      if (res.success && res.data?.video) { setVideo(res.data.video); toast.success("Dubbing cancelled."); }
                      else toast.error(res.message || "Failed to cancel dubbing.");
                    }}>Cancel dubbing</Button>
                  )}
                  {video.dubbing?.status === "failed" && video.dubbing.error && (
                    <p className="text-sm text-destructive">Last dubbing error: {video.dubbing.error}</p>
                  )}
                  {dubGroups.length ? (
                    <div className="space-y-3">
                      {dubGroups.map((group) => {
                        const langCode = group[0].language;
                        const langLabel =
                          LANGUAGES.find((l) => l.code === langCode)?.label || langCode;
                        return (
                          <details key={langCode} className="rounded-md border bg-card">
                            <summary className="cursor-pointer list-none p-3 font-medium">
                              {langLabel} ({langCode}) — {group.length}{" "}
                              {group.length === 1 ? "dub" : "dubs"}
                            </summary>
                            <div className="space-y-3 border-t p-3">
                              {group.map((dub) => {
                                const dubKey = `${dub.language}::${dub.voice || ""}`;
                                return (
                                  <div
                                    key={dubKey}
                                    className="space-y-2 rounded-md border p-3"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div>
                                        <p className="text-sm font-medium">
                                          {dub.voice || "Voice not recorded"}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                          {langLabel} ({langCode})
                                          {dub.durationSeconds
                                            ? ` • ${dub.durationSeconds}s`
                                            : ""}
                                          {dub.subtitlesBurned
                                            ? " • subtitles burned in"
                                            : ""}
                                        </p>
                                      </div>
                                      <div className="flex flex-wrap items-center gap-3">
                                        <a
                                          href={dub.url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-sm underline"
                                        >
                                          Open file
                                        </a>
                                        <a
                                          href={`/videos/${id}/publish?language=${encodeURIComponent(
                                            dub.language,
                                          )}&voice=${encodeURIComponent(dub.voice || "")}`}
                                          className="text-sm font-medium underline"
                                        >
                                          Prepare to publish on YouTube
                                        </a>
                                        <Button
                                          variant="destructive"
                                          size="sm"
                                          disabled={deletingDubKey === dubKey}
                                          onClick={async () => {
                                            if (
                                              !window.confirm(
                                                `Delete the ${langLabel} dub with voice ${
                                                  dub.voice || ""
                                                }?`,
                                              )
                                            )
                                              return;
                                            setDeletingDubKey(dubKey);
                                            const res = await api.delete<{
                                              video: VideoDetail;
                                            }>(
                                              `/api/videos/${video._id}/dub?language=${encodeURIComponent(
                                                dub.language,
                                              )}&voice=${encodeURIComponent(
                                                dub.voice || "",
                                              )}`,
                                            );
                                            if (res.success) {
                                              toast.success(
                                                res.message || "Dub deleted.",
                                              );
                                              if (res.data?.video)
                                                setVideo(res.data.video);
                                              else await load();
                                            } else {
                                              toast.error(
                                                res.message || "Failed to delete dub.",
                                              );
                                            }
                                            setDeletingDubKey(null);
                                          }}
                                        >
                                          {deletingDubKey === dubKey ? (
                                            <>
                                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                              Deleting…
                                            </>
                                          ) : (
                                            "Delete"
                                          )}
                                        </Button>
                                      </div>
                                    </div>
                                    <video
                                      src={dub.url}
                                      controls
                                      className="w-full rounded-md border"
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Study-journey lesson video (optional, separate product)</CardTitle>
                  <CardDescription>
                    A brand-new lesson render: AI writes a fresh script, narrates it and burns in translated subtitles over background footage.
                    This is not a re-render of the dubbed video — use it only if you want a second, lesson-style version.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor="lessonLanguage">Lesson language</Label>
                    <select
                      id="lessonLanguage"
                      value={lessonLanguage}
                      onChange={(e) => setLessonLanguage(e.target.value)}
                      className="h-9 rounded-md border-2 border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    >
                      {[...(video.targetLanguages || []), video.transcriptLanguage || video.originalLanguage || "en"]
                        .filter((value, index, array) => value && array.indexOf(value) === index)
                        .map((code) => (
                          <option key={code} value={code}>
                            {LANGUAGES.find((l) => l.code === code)?.label || code} ({code})
                          </option>
                        ))}
                    </select>
                    <div className="flex flex-wrap items-center gap-2">
                      <Label htmlFor="lessonEdgeVoice">Free Edge voice</Label>
                      <select
                        id="lessonEdgeVoice"
                        value={lessonEdgeVoice}
                        onChange={(e) => setLessonEdgeVoice(e.target.value)}
                        className="h-9 rounded-md border-2 border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                      >
                        {(edgeVoiceOptionsByLang[lessonLanguage] || []).map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                      <Label htmlFor="lessonVoiceId">ElevenLabs voice ID (optional)</Label>
                      <select
                        id="lessonVoiceId"
                        value={lessonVoiceId}
                        onChange={(e) => setLessonVoiceId(e.target.value)}
                        className="h-9 rounded-md border-2 border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                      >
                        <option value="">Default voice (Edge TTS)</option>
                        {elevenVoices.map((voice) => (
                          <option key={voice.voice_id} value={voice.voice_id}>
                            {voice.name} ({voice.voice_id})
                          </option>
                        ))}
                      </select>
                      <Input
                        id="lessonVoiceIdCustom"
                        value={lessonVoiceId}
                        onChange={(e) => setLessonVoiceId(e.target.value)}
                        placeholder="Or paste any ElevenLabs voice ID"
                        className="h-9 w-64"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Generates a lesson video on the original footage with a
                      single burned-in subtitle track and voiceover.
                    </p>
                    <Button
                      onClick={async () => {
                        setGeneratingLesson(true);
                        const res = await api.post<{ video: VideoDetail }>(`/api/videos/${video._id}/lesson`, { language: lessonLanguage, voiceId: lessonVoiceId.trim() || undefined, voice: lessonEdgeVoice, backgroundOnly: false });
                        if (res.success) {
                          toast.success(res.message || "Lesson generation started.");
                          if (res.data?.video) setVideo(res.data.video);
                        } else {
                          toast.error(res.message || "Failed to start lesson generation.");
                        }
                        setGeneratingLesson(false);
                      }}
                      disabled={generatingLesson || video.lessonGeneration?.status === "processing"}
                    >
                      {video.lessonGeneration?.status === "processing" ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {`Generating… ${video.lessonGeneration.progress ?? 0}%`}
                        </>
                      ) : generatingLesson ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Starting…
                        </>
                      ) : (
                        "Generate new lesson video"
                      )}
                    </Button>
                    {video.lessonGeneration?.status === "processing" && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={async () => {
                          const res = await api.post<{ video: VideoDetail }>(`/api/videos/${video._id}/lesson/cancel`);
                          if (res.success && res.data?.video) {
                            setVideo(res.data.video);
                            toast.success("Lesson generation cancelled.");
                          } else {
                            toast.error(res.message || "Failed to cancel lesson generation.");
                          }
                        }}
                      >
                        Cancel generation
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      onClick={async () => {
                        const res = await api.post<{ video: VideoDetail }>(`/api/videos/${video._id}/translate`, { language: lessonLanguage });
                        if (res.success) {
                          toast.success(res.message || "Translated transcript updated.");
                          if (res.data?.video) setVideo(res.data.video);
                        } else {
                          toast.error(res.message || "Failed to update translated transcript.");
                        }
                      }}
                      disabled={!video || video.lessonGeneration?.status === "processing"}
                    >
                      Update translated transcript ({lessonLanguage})
                    </Button>
                  </div>

                  {video.lessonGeneration?.status === "processing" && (
                    <>
                      <p className="text-sm text-muted-foreground">
                        AI is writing the lesson and synthesizing voice for {video.lessonGeneration.language}. You can leave this page.
                      </p>
                      <Progress value={video.lessonGeneration.progress || 0} className="h-2" />
                    </>
                  )}
                  {video.lessonGeneration?.status === "failed" && video.lessonGeneration.error && (
                    <p className="text-sm text-destructive">Last lesson error: {video.lessonGeneration.error}</p>
                  )}

                  {(video.lessonVideos || []).filter((lesson) => (lesson.source ?? "lesson") === "lesson").length ? (
                    <div className="space-y-4">
                      {(video.lessonVideos || [])
                        .filter((lesson) => (lesson.source ?? "lesson") === "lesson")
                        .map((lesson, index) => (
                        <details key={`${lesson.language}-${index}`} className="group rounded-md border bg-card">
                          <summary className="cursor-pointer list-none p-4 font-medium">
                            {LANGUAGES.find((l) => l.code === lesson.language)?.label || lesson.language} ({lesson.language}) lesson video
                          </summary>
                          <div className="space-y-3 border-t p-3">
                            <LessonVideoCard videoId={id} lesson={lesson} />
                            <Button
                              size="sm"
                              onClick={async () => {
                                const toastInstance = toast;
                                const res = await api.post<{ video: VideoDetail }>(`/api/videos/${video._id}/lesson`, { language: lesson.language, voiceId: lessonVoiceId.trim() || undefined, backgroundOnly: true });
                                if (res.success) {
                                  toastInstance.success(res.message || `Regenerating lesson for ${lesson.language}.`);
                                  if (res.data?.video) setVideo(res.data.video);
                                } else {
                                  toastInstance.error(res.message || "Failed to start lesson generation.");
                                }
                              }}
                            >
                              Regenerate video ({lesson.language})
                            </Button>
                          </div>
                        </details>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

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
        </div>
      </AppShell>
    </AuthGuard>
  );
}
