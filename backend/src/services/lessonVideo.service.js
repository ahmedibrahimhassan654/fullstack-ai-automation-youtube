import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import ffmpegStatic from "ffmpeg-static";
import cloudinary, { isCloudinaryConfigured } from "../config/cloudinary.js";
import { env } from "../config/env.js";
import {
  generateEducationalScript,
  translateTranscriptSegments,
} from "./aiMetadata.service.js";
import { synthesizeSpeech, VOICES } from "./tts.service.js";

const TEMP_DIR = os.tmpdir();

const toVtt = (segments) => {
  const format = (value) => {
    const total = Math.max(0, value || 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = Math.floor(total % 60);
    const millis = Math.floor((total - Math.floor(total)) * 1000);
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
  };
  let out = "WEBVTT\n\n";
  (segments || []).forEach((segment, index) => {
    if (!segment?.text) return;
    const start = format(segment.start);
    const end = format(Math.max(segment.end, segment.start + 0.2));
    out += `${index + 1}\n${start} --> ${end}\n${segment.text}\n\n`;
  });
  return out;
};

const toSrt = (segments) => {
  const format = (value) => {
    const total = Math.max(0, value || 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = Math.floor(total % 60);
    const millis = Math.floor((total - Math.floor(total)) * 1000);
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
  };
  return (segments || [])
    .filter((s) => s?.text)
    .map((seg, index) => {
      const start = format(seg.start);
      const end = format(Math.max(seg.end, seg.start + 0.2));
      return `${index + 1}\n${start} --> ${end}\n${seg.text}\n`;
    })
    .join("\n");
};

function cleanupFiles(files) {
  for (const file of files) {
    try {
      if (file && fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      // best effort
    }
  }
}

const runFfmpeg = (args, cwd) =>
  new Promise((resolve, reject) => {
    const proc = spawn(ffmpegStatic, args, {
      cwd: cwd || process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${code}): ${stderr.slice(-500)}`));
    });
  });

const uploadFile = (filePath, options) =>
  new Promise((resolve, reject) => {
    cloudinary.uploader.upload(filePath, options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
  });

const uploadFileWithTimeout = (filePath, options, timeoutMs = 120000) =>
  Promise.race([
    uploadFile(filePath, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Cloudinary upload timed out')), timeoutMs),
    ),
  ]);

export const generateLessonVideo = async ({
  video,
  language,
  voiceId,
  voice,
  backgroundOnly = false,
  onProgress,
}) => {
  const report = async (value) => {
    try {
      await onProgress?.(value);
    } catch {
      // ignore progress update failures
    }
  };

  if (!isCloudinaryConfigured()) {
    const err = new Error("Cloudinary is not configured on the server");
    err.statusCode = 500;
    throw err;
  }

  await report(15);

  // Let the AI write the lesson directly in the requested language.
  const script = await generateEducationalScript({
    video,
    targetLanguage: language,
  });
  if (!script.trim()) throw new Error("Could not generate lesson script");
  await report(30);
  console.log('[lessonVideo] script done len', script.length);

  const selectedVoice =
    voice || (voiceId ? String(voiceId).trim() : VOICES[language] || VOICES.en);
  console.log('[lessonVideo] starting TTS');
  const {
    buffer: audioBuffer,
    segments: lessonSegments,
    wordSegments: lessonWordSegments,
  } = await synthesizeSpeech(script, selectedVoice, {
    voiceId: voiceId ? String(voiceId).trim() : undefined,
    onProgress: async (value) => {
      await onProgress?.(30 + Math.round(value * 0.2));
    },
  });
  await report(50);

  const audioFile = path.join(
    TEMP_DIR,
    `lesson-${video._id}-${language}-${Date.now()}.mp3`,
  );
  const outputFile = path.join(
    TEMP_DIR,
    `lesson-video-${video._id}-${language}-${Date.now()}.mp4`,
  );
  let subtitleFile = null;
  let srtFile = null;
  let musicFile = null;
  fs.writeFileSync(audioFile, audioBuffer);
  await report(58);

  // Optional background music bed.
  if (env.backgroundMusicUrl) {
    try {
      const musicRes = await fetch(env.backgroundMusicUrl);
      if (musicRes.ok) {
        musicFile = path.join(TEMP_DIR, `music-${video._id}-${Date.now()}.mp3`);
        fs.writeFileSync(musicFile, Buffer.from(await musicRes.arrayBuffer()));
      }
    } catch (musicError) {
      console.warn(
        "[lessonVideo] background music fetch failed:",
        musicError?.message,
      );
      musicFile = null;
    }
  }

  // Prepare subtitles for burned-in rendering (voiceover mode).
  const duration = Number(video.durationSeconds) || 0;
  const burnSegments =
    lessonSegments && lessonSegments.length
      ? lessonSegments.map((segment, index, list) => {
          const start = Math.max(0, Number(segment?.start) || 0);
          let end = Math.max(Number(segment?.end) || 0, start + 0.2);
          if (duration > 0) {
            end = Math.min(end, duration);
            if (end <= start) end = Math.min(duration, start + 0.2);
          }
          return { ...segment, start, end };
        })
      : [
          {
            start: 0,
            end:
              duration > 0
                ? duration
                : Math.max(1, script.split(/\\s+/).length / 2.5),
            text: script,
          },
        ];
  srtFile = path.join(
    TEMP_DIR,
    `lesson-${video._id}-${language}-${Date.now()}.srt`,
  );
  fs.writeFileSync(srtFile, toSrt(burnSegments));
  const subtitlesFilter = `subtitles=${srtFile.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1\\\\:")}:force_style='FontSize=24,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,Shadow=1,MarginV=40'`;

  let ffmpegArgs;

  if (backgroundOnly) {
    const subtitleFileName = srtFile ? path.basename(srtFile) : null;
    const audioInputs = musicFile
      ? ["-i", audioFile, "-stream_loop", "-1", "-i", musicFile]
      : ["-i", audioFile];
    const mixArgs = musicFile
      ? [
          "-map",
          "0:v:0",
          "-filter_complex",
          "[1:a]volume=1.0[narr];[2:a]volume=0.12[music];[narr][music]amix=inputs=2:duration=shortest:dropout_transition=2[a]",
          "-map",
          "[a]",
        ]
      : ["-map", "0:v:0", "-map", "1:a:0"];
    const subtitleArgs = [];
    ffmpegArgs = [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x0f172a:s=1280x720:d=3600",
      ...audioInputs,
      ...mixArgs,
      ...subtitleArgs,
      "-vf",
      subtitlesFilter,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "24",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-shortest",
      outputFile,
    ];
  } else if (musicFile) {
    ffmpegArgs =
      duration > 0
        ? [
            "-y",
            "-i",
            video.publicUrl,
            "-i",
            audioFile,
            "-stream_loop",
            "-1",
            "-i",
            musicFile,
            "-filter_complex",
            `[1:a]apad=whole_dur=${duration},volume=1.0[narr];[2:a]volume=0.12[music];[narr][music]amix=inputs=2:duration=first:dropout_transition=2[a]`,
            "-map",
            "0:v:0",
            "-map",
            "[a]",
            "-vf",
      subtitlesFilter,
      "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-t",
            String(duration),
            outputFile,
          ]
        : [
            "-y",
            "-i",
            video.publicUrl,
            "-i",
            audioFile,
            "-stream_loop",
            "-1",
            "-i",
            musicFile,
            "-filter_complex",
            `[1:a]volume=1.0[narr];[2:a]volume=0.12[music];[narr][music]amix=inputs=2:duration=shortest:dropout_transition=2[a]`,
            "-map",
            "0:v:0",
            "-map",
            "[a]",
            "-vf",
      subtitlesFilter,
      "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            outputFile,
          ];
  } else {
    ffmpegArgs =
      duration > 0
        ? [
            "-y",
            "-i",
            video.publicUrl,
            "-i",
            audioFile,
            "-filter_complex",
            `[1:a]apad=whole_dur=${duration}[a]`,
            "-map",
            "0:v:0",
            "-map",
            "[a]",
            "-vf",
      subtitlesFilter,
      "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-t",
            String(duration),
            outputFile,
          ]
        : [
            "-y",
            "-i",
            video.publicUrl,
            "-i",
            audioFile,
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-vf",
      subtitlesFilter,
      "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            outputFile,
          ];
  }

  try {
    await report(65);
    await runFfmpeg(ffmpegArgs, TEMP_DIR);
    await report(82);

    const result = await uploadFileWithTimeout(outputFile, {
      resource_type: "video",
      folder: `${env.cloudinaryFolder}/lessons`,
      use_filename: true,
      unique_filename: true,
      overwrite: false,
    });
    await report(92);

    const rawSubtitleSegments =
      (lessonWordSegments && lessonWordSegments.length
        ? lessonWordSegments
        : lessonSegments) || [];
    const subtitleSegments =
      duration > 0 && rawSubtitleSegments.length
        ? rawSubtitleSegments.map((segment, index, list) => {
            const start = Math.max(0, Number(segment?.start) || 0);
            let end = Math.max(Number(segment?.end) || 0, start + 0.2);
            if (duration > 0) {
              end = Math.min(end, duration);
              if (end <= start) end = Math.min(duration, start + 0.2);
            }
            return { ...segment, start, end };
          })
        : rawSubtitleSegments;
    const subtitleContent = toVtt(subtitleSegments);
    subtitleFile = path.join(
      TEMP_DIR,
      `lesson-${video._id}-${language}-${Date.now()}.vtt`,
    );
    fs.writeFileSync(subtitleFile, subtitleContent);
    let subtitlesUrl = null;
    try {
      const subtitleUpload = await uploadFileWithTimeout(subtitleFile, {
        resource_type: "raw",
        folder: `${env.cloudinaryFolder}/lessons`,
        use_filename: true,
        unique_filename: true,
        overwrite: false,
      });
      subtitlesUrl = subtitleUpload.secure_url;
    } catch (subtitleError) {
      console.error(
        "[lessonVideo] subtitle upload failed:",
        subtitleError?.message,
      );
    }
    await report(95);

    return {
      language,
      url: result.secure_url,
      storagePath: result.public_id,
      durationSeconds: Math.round(
        result.duration || video.durationSeconds || 0,
      ),
      voice: selectedVoice,
      script,
      segments: (backgroundOnly ? burnSegments : lessonSegments) || [],
      subtitlesUrl,
    };
  } finally {
    cleanupFiles([audioFile, outputFile, subtitleFile, musicFile, srtFile]);
  }
};
