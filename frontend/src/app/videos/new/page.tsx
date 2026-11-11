"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGuard } from "@/components/auth-guard";
import { AppShell } from "@/components/app-shell";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/toast-provider";

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
  { code: "tr", label: "Turkish" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
];

export default function NewVideoPage() {
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [originalLanguage, setOriginalLanguage] = useState("en");
  const [targetLanguages, setTargetLanguages] = useState<string[]>([]);
  const [links, setLinks] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [subtitle, setSubtitle] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const progressNotified = useRef(false);
  const toggleTarget = (code: string) => {
    setTargetLanguages((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Please select a video file.");
      toast.error("Please select a video file.");
      return;
    }
    setError(null);
    setUploading(true);
    setProgress(0);
    progressNotified.current = false;
    toast.success("Upload started…");

    const formData = new FormData();
    formData.append("video", file);
    formData.append("title", title || file.name);
    formData.append("description", description);
    formData.append("originalLanguage", originalLanguage);
    formData.append("targetLanguages", JSON.stringify(targetLanguages));
    formData.append("links", links);

    attachments.forEach((f) => formData.append("attachments", f));
    if (subtitle) formData.append("subtitle", subtitle);

    const handleProgress = (pct: number) => {
      setProgress(pct);
      if (pct >= 10 && !progressNotified.current) {
        progressNotified.current = true;
        toast.info("Upload in progress…");
      }
    };
    const res = await api.upload<{ video: { _id: string } }>(
      "/api/videos/upload",
      formData,
      handleProgress,
    );
    setUploading(false);
    if (res.success && (res.data as { video?: { _id: string } })?.video?._id) {
      const id = (res.data as { video: { _id: string } }).video._id;
      // Kick off the async processing pipeline (transcription -> ...).
      await api.post(`/api/videos/${id}/process`);
      toast.success(res.message || "Video uploaded successfully.");
      router.push("/videos");
    } else {
      const message = res.message || "Upload failed.";
      setError(message);
      toast.error(message);
    }
  };

  return (
    <AuthGuard>
      <AppShell title="Upload Video" description="Add a new source video to process">
        <Card>
            <CardHeader>
              <CardTitle>Manual video upload</CardTitle>
              <CardDescription>
                Upload an educational video. Choose original and target
                languages, plus optional attachments and links.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <div className="space-y-2">
                    <Label htmlFor="video">Video file</Label>
                    <Input
                      id="video"
                      type="file"
                      accept="video/*"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                      required
                    />
                  </div>
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Video title"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description (optional)</Label>
                  <Input
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Short description"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="originalLanguage">
                      Original (spoken) language
                    </Label>
                    <select
                      id="originalLanguage"
                      value={originalLanguage}
                      onChange={(e) => setOriginalLanguage(e.target.value)}
                      className="w-full h-9 rounded-md border-2 border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    >
                      {LANGUAGES.map((l) => (
                        <option key={l.code} value={l.code}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Translate transcript to</Label>
                    <div className="grid grid-cols-2 gap-1 max-h-40 overflow-auto border rounded-md p-2">
                      {LANGUAGES.filter((l) => l.code !== originalLanguage).map(
                        (l) => (
                          <label
                            key={l.code}
                            className="flex items-center gap-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={targetLanguages.includes(l.code)}
                              onChange={() => toggleTarget(l.code)}
                            />
                            {l.label}
                          </label>
                        ),
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="attachments">
                    Attachments (PDF, docs, images)
                  </Label>
                  <Input
                    id="attachments"
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.zip,image/*"
                    onChange={(e) =>
                      setAttachments(Array.from(e.target.files || []))
                    }
                  />
                  {attachments.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {attachments.length} file(s) selected
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="subtitle">
                    Original subtitle file (.srt or .vtt, optional)
                  </Label>
                  <Input
                    id="subtitle"
                    type="file"
                    accept=".srt,.vtt,text/plain,application/x-subrip"
                    onChange={(e) => setSubtitle(e.target.files?.[0] || null)}
                  />
                  {subtitle && (
                    <p className="text-xs text-muted-foreground">
                      {subtitle.name} selected — will be used as the source
                      transcript for translation and dubbing.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="links">Links (one URL per line)</Label>
                  <textarea
                    id="links"
                    value={links}
                    onChange={(e) => setLinks(e.target.value)}
                    placeholder="https://example.com/resource"
                    className="w-full min-h-24 rounded-md border-2 border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>

                {uploading && <Progress value={progress} />}
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={uploading}>
                  {uploading ? `Uploading… ${progress}%` : "Upload"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </AppShell>
    </AuthGuard>
  );
}
