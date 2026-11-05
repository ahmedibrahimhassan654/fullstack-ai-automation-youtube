"use client";

import { useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api, API_BASE } from "@/lib/api";

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

type LessonSegment = { start: number; end: number; text: string };

type LessonVideo = {
  language: string;
  url: string;
  voice?: string;
  durationSeconds?: number;
  script?: string;
  segments?: LessonSegment[];
  subtitlesUrl?: string | null;
};

export default function LessonVideoCard({ videoId, lesson }: { videoId: string; lesson: LessonVideo }) {
  const [currentTime, setCurrentTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    const onTimeUpdate = () => setCurrentTime(element.currentTime);
    element.addEventListener("timeupdate", onTimeUpdate);
    const onLoaded = () => {
      const track = element.textTracks?.[0];
      if (track) track.mode = "showing";
    };
    element.addEventListener("loadedmetadata", onLoaded);
    return () => {
      element.removeEventListener("timeupdate", onTimeUpdate);
      element.removeEventListener("loadedmetadata", onLoaded);
    };
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const segments = lesson.segments || [];

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">
            {LANGUAGES.find((l) => l.code === lesson.language)?.label || lesson.language} ({lesson.language})
          </p>
          <p className="text-xs text-muted-foreground">
            {lesson.voice || "generated voice"}{lesson.durationSeconds ? ` • ${lesson.durationSeconds}s` : ""}
          </p>
        </div>
        <a
          href={lesson.url}
          target="_blank"
          rel="noreferrer"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Open generated file
        </a>
      </div>

      <video ref={videoRef} src={lesson.url} controls className="w-full rounded-md border" crossOrigin="anonymous">
        <track
          kind="subtitles"
          src={`${API_BASE}/api/videos/${videoId}/lessons/${lesson.language}/subtitles.vtt?token=${encodeURIComponent(api.getToken() || "")}`}
          srcLang={lesson.language}
          label={LANGUAGES.find((l) => l.code === lesson.language)?.label || lesson.language}
          default
        />
      </video>

      <div className="max-h-96 space-y-2 overflow-y-auto rounded-md border p-2">
        {segments.length ? (
          segments.map((segment, index) => {
            const active =
              currentTime >= segment.start &&
              currentTime <= Math.max(segment.end, segment.start + 0.5);
            return (
              <button
                key={`${segment.start}-${index}`}
                type="button"
                onClick={() => {
                  if (videoRef.current) {
                    videoRef.current.currentTime = segment.start;
                    void videoRef.current.play();
                  }
                }}
                className={`block w-full rounded-md border px-2 py-1 text-left text-sm transition-colors ${
                  active ? "border-primary bg-primary/10 text-primary" : "border-transparent hover:bg-muted"
                }`}
              >
                <span className="mr-2 font-mono text-xs text-muted-foreground">{formatTime(segment.start)}</span>
                {segment.text}
              </button>
            );
          })
        ) : lesson.script ? (
          <p className="text-sm whitespace-pre-wrap">{lesson.script}</p>
        ) : null}
      </div>
    </div>
  );
}