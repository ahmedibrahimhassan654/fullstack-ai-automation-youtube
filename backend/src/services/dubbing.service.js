import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import cloudinary, { isCloudinaryConfigured } from '../config/cloudinary.js';
import { env } from '../config/env.js';
import { synthesizeSpeech, VOICES } from './tts.service.js';
import {
  translateTranscriptSegments,
  findUntranslatedSegments,
  condenseTranslationForDuration,
} from './aiMetadata.service.js';

const TEMP_DIR = os.tmpdir();

const writeTempFile = (name, buffer) => {
  const file = path.join(TEMP_DIR, name);
  fs.writeFileSync(file, buffer);
  return file;
};

const cleanup = (files) => {
  for (const file of files) {
    try {
      if (file && fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      // best-effort cleanup
    }
  }
};

const runFfmpeg = (args, options = {}) =>
  new Promise((resolve, reject) => {
    const proc = spawn(ffmpegStatic, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: options.cwd || undefined,
    });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${code}): ${stderr.slice(-800)}`));
    });
  });

const formatSrtTime = (seconds) => {
  const total = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  const millis = Math.round((total - Math.floor(total)) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
};

const toSrt = (segments) =>
  segments
    .map((segment, index) => {
      const start = formatSrtTime(segment.start);
      const end = formatSrtTime(Math.max(segment.end, segment.start + 0.4));
      return `${index + 1}\n${start} --> ${end}\n${segment.text}\n`;
    })
    .join('\n');

// White text on a soft black box: readable on any footage.
const SUBTITLE_STYLE =
  "FontName=Arial,FontSize=18,PrimaryColour=&H00FFFFFF,BackColour=&H8C000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=30,Alignment=2";

const uploadFile = (filePath, options) =>
  new Promise((resolve, reject) => {
    cloudinary.uploader.upload(filePath, options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
  });

const getAudioDurationSeconds = async (filePath) => {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegStatic, ['-hide_banner', '-i', filePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('close', () => {
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (match) {
        resolve(
          Number(match[1]) * 3600 +
            Number(match[2]) * 60 +
            Number(match[3]),
        );
      } else {
        resolve(0);
      }
    });
    proc.on('error', () => resolve(0));
  });
};

const estimateSpeechSeconds = (text, language) => {
  const rates = { ar: 12, en: 14, default: 13 };
  const rate = rates[language] || rates.default;
  return Math.max(0.5, String(text || '').trim().length / rate);
};

const createSilenceWav = async (durationSeconds, filePath) => {
  if (durationSeconds <= 0.02) return false;
  await runFfmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=24000:cl=mono',
    '-t',
    durationSeconds.toFixed(3),
    '-acodec',
    'pcm_s16le',
    '-ar',
    '24000',
    '-ac',
    '1',
    filePath,
  ]);
  return fs.existsSync(filePath);
};

const normalizeToWav = async (inputPath, outputPath) => {
  await runFfmpeg([
    '-y',
    '-i',
    inputPath,
    '-acodec',
    'pcm_s16le',
    '-ar',
    '24000',
    '-ac',
    '1',
    outputPath,
  ]);
};

const getTranslationSegments = async (video, language, onProgress = null) => {
  const originalLanguage = video.originalLanguage || video.transcriptLanguage || 'en';
  const toSegment = (s) => ({
    start: Number(s.start) || 0,
    end: Number(s.end) || 0,
    text: String(s.text || '').trim(),
    spokenText: String(s.spokenText || s.text || '').trim(),
  });

  if (String(language).toLowerCase() === String(originalLanguage).toLowerCase()) {
    return (video.transcriptSegments || []).map(toSegment);
  }

  const existing = (video.translations || []).find(
    (t) => String(t.language).toLowerCase() === String(language).toLowerCase(),
  );
  if (existing?.segments?.length) {
    const segments = existing.segments.map(toSegment);

    // A stored translation can be stale, or it can have been saved while the
    // AI provider was rate limited and still contain the source language.
    // Dubbing it would speak English with a foreign voice, so it is verified
    // first and re-translated when it is not really in the target language.
    const untranslated = findUntranslatedSegments({
      segments,
      targetLanguage: language,
      sourceSegments: video.transcriptSegments || [],
      sourceLanguage: originalLanguage,
    });

    // A translation without a spoken version would read the English technical
    // names with the Arabic voice, so it is regenerated as well.
    const missingSpoken = segments.filter(
      (s) => !String(s.spokenText || '').trim(),
    ).length;

    if (untranslated.length === 0 && missingSpoken === 0) {
      return segments;
    }

    console.warn(
      `[dubbing] stored translation for ${language} needs regenerating (${untranslated.length} untranslated, ${missingSpoken} without a spoken version) - re-translating`,
    );
  }

  if (Array.isArray(video.transcriptSegments) && video.transcriptSegments.length) {
    const translated = await translateTranscriptSegments({
      segments: video.transcriptSegments,
      targetLanguage: language,
      originalLanguage,
      onProgress,
    });

    const untranslated = findUntranslatedSegments({
      segments: translated,
      targetLanguage: language,
      sourceSegments: video.transcriptSegments || [],
      sourceLanguage: originalLanguage,
    });
    if (untranslated.length > 0) {
      const err = new Error(
        `Translation to ${language} is incomplete: ${untranslated.length} of ${translated.length} segments are still in ${originalLanguage}. The AI provider is most likely rate limited - please try again.`,
      );
      err.code = 'TRANSLATION_FAILED';
      err.statusCode = 502;
      throw err;
    }

    return translated.map(toSegment);
  }

  return [];
};


const normalizeSegmentTiming = (segments, totalDuration) => {
  const normalized = (segments || [])
    .map((segment) => ({
      start: Math.max(0, Number(segment?.start) || 0),
      end: Math.max(Number(segment?.end) || 0, (Number(segment?.start) || 0) + 0.1),
      text: String(segment?.text || '').trim(),
    }))
    .filter((segment) => segment.text)
    .sort((a, b) => a.start - b.start);

  if (normalized.length === 0) return normalized;

  if (totalDuration > 0) {
    // Keep the final cue visible through the end of the source video so the
    // subtitles never finish while the video is still playing.
    normalized[normalized.length - 1].end = Math.max(
      normalized[normalized.length - 1].end,
      totalDuration,
    );
    let cursor = 0;
    for (const segment of normalized) {
      if (segment.start < cursor) segment.start = cursor;
      if (segment.end <= segment.start) segment.end = segment.start + 0.1;
      cursor = segment.end;
    }
  }

  return normalized;
};

// Arabic and other non-latin languages need noticeably longer than English
// for the same content. Speeding the voice up to 1.6x was the reason the
// dub sounded rushed and the pronunciation came out wrong, so the tempo is
// kept close to natural and the remaining overflow is left as a short pause
// instead of being crammed into the next sentence.
const MAX_TEMPO = 1.3;

/**
 * Merge subtitle cues into whole sentences.
 *
 * Dubbing cue-by-cue forces every short cue to fit its own ~2s slot, which is
 * what produced the 2x speed-ups and the mid-word cuts. Speaking whole
 * sentences and letting them use the surrounding pauses sounds natural.
 */
export const mergeCuesIntoSentences = (segments, videoDuration) => {
  const blocks = [];
  let current = null;

  for (const segment of segments) {
    const spoken = String(segment.spokenText || segment.text || '').trim();
    if (!current) {
      current = {
        start: segment.start,
        end: segment.end,
        texts: [segment.text],
        spoken: [spoken],
      };
      continue;
    }
    const gap = segment.start - current.end;
    const combined = `${current.texts.join(" ")} ${segment.text}`.replace(/\s+/g, " ");
    const endsSentence = /[.!?؟۔…]["'”’)\]]?\s*$/.test(current.texts[current.texts.length - 1]);
    if (gap <= 0.9 && combined.length <= 320 && !endsSentence) {
      current.end = segment.end;
      current.texts.push(segment.text);
      current.spoken.push(spoken);
    } else {
      blocks.push(current);
      current = {
        start: segment.start,
        end: segment.end,
        texts: [segment.text],
        spoken: [spoken],
      };
    }
  }
  if (current) blocks.push(current);

  return blocks
    .map((block, index) => ({
      start: block.start,
      end: block.end,
      nextStart:
        index + 1 < blocks.length
          ? blocks[index + 1].start
          : Math.max(block.end, videoDuration || block.end),
      // The subtitles keep the English technical names in Latin script, the
      // narration reads them the way an Arabic speaker pronounces them.
      text: block.texts.join(" ").replace(/\s+/g, " ").trim(),
      spokenText: block.spoken.join(" ").replace(/\s+/g, " ").trim(),
    }))
    .filter((block) => block.text);
};

/**
 * Applies a single tempo factor to a clip.
 *
 * The whole dub uses one uniform tempo (see `planDubTiming`) instead of
 * speeding every sentence up individually, which is what made some sentences
 * sound rushed while others stayed natural.
 */
const applyTempo = async (inputPath, outputPath, tempo) => {
  if (tempo <= 1.02) {
    await normalizeToWav(inputPath, outputPath);
    return (await getAudioDurationSeconds(outputPath)) || 0;
  }

  await runFfmpeg([
    '-y',
    '-i',
    inputPath,
    '-filter:a',
    `atempo=${tempo.toFixed(4)}`,
    '-acodec',
    'pcm_s16le',
    '-ar',
    '24000',
    '-ac',
    '1',
    outputPath,
  ]);

  return (await getAudioDurationSeconds(outputPath)) || 0;
};

/**
 * Works out the single tempo that lets the whole narration fit the video.
 *
 * The target language is usually longer than the English source (Arabic needs
 * ~1.3x the time for the same content), so the dub has to be compressed to
 * stay in sync. Compressing it once, uniformly, keeps the voice natural -
 * per-sentence clamping produced a rushed voice on some lines and a slow one
 * on others.
 */
export const planDubTiming = ({ totalSpeechSeconds, videoDuration }) => {
  const totalSpeech = Math.max(0, Number(totalSpeechSeconds) || 0);
  const available = Math.max(0, Number(videoDuration) || 0);

  if (!totalSpeech || !available) return 1;

  const required = totalSpeech / available;
  if (required <= 1.02) return 1;

  return Math.min(MAX_TEMPO, required);
};

export const generateDubbedVideo = async ({ video, language, voice = null, elevenLabsVoiceId = null, onProgress = null }) => {
  if (!isCloudinaryConfigured()) {
    const err = new Error('Cloudinary is not configured on the server');
    err.statusCode = 500;
    throw err;
  }

  const videoDuration = Math.max(0, Number(video.durationSeconds) || 0);
  const reportProgress = async (value) => {
    if (!onProgress) return;
    try {
      await onProgress(value);
    } catch (progressError) {
      if (progressError?.code === 'DUB_CANCELLED') throw progressError;
    }
  };

  const segments = normalizeSegmentTiming(
    (await getTranslationSegments(video, language, async (ratio) => {
      // Translating the transcript is the slowest part of a dub, so it gets
      // its own slice of the progress bar instead of looking stuck.
      await reportProgress(Math.min(35, 10 + Math.round(ratio * 25)));
    })).map((s) => ({
      start: Math.max(0, Number(s.start) || 0),
      end: Math.max(Number(s.end) || 0, (Number(s.start) || 0) + 0.1),
      text: String(s.text || '').trim(),
    })),
    videoDuration,
  )
    .filter((s) => s.text)
    .sort((a, b) => a.start - b.start);

  if (segments.length === 0) {
    const err = new Error('No timed transcript segments available for dubbing');
    err.statusCode = 400;
    throw err;
  }

  const selectedVoice = voice || VOICES[language] || VOICES.en;
  // A chosen Edge speaker must be used verbatim, even if an ElevenLabs /
  // Google voice is configured in the environment.
  const useEdge = /^[a-z]{2,3}-[A-Z]{2,4}-[A-Za-z]+Neural$/.test(String(selectedVoice));
  const ttsOptions = useEdge
    ? {
        provider: 'edge',
        // A slightly brisker delivery than the default (-3%) buys back tempo
        // budget, so the whole dub fits the video without sounding rushed.
        rate: '+2%',
        // One voice for the whole narration. Switching to an English voice for
        // the technical names interrupts the lesson, so the spoken version
        // already renders them in Arabic script.
        mixedScript: false,
      }
    : { provider: 'elevenlabs', voiceId: elevenLabsVoiceId };

  const blocks = mergeCuesIntoSentences(segments, videoDuration);

  const tempFiles = [];
  const clips = [];
  const burnSegments = [];
  const prepared = [];

  // Phase 1 - speak every sentence at natural speed and measure it.
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];

    if (videoDuration > 0 && block.start >= videoDuration) break;

    // The narration uses the spoken version (technical names in Arabic
    // script, numbers as Arabic words); the subtitles keep the clear text.
    let spokenText = String(block.spokenText || block.text || '').trim();

    // Per-block fitting: if this sentence's natural speech is longer than
    // its slot on the timeline, condense the spoken text (never the subtitle
    // text) so the sentence finishes inside its slot instead of being cut
    // mid-word by the global -t. Condensing is per-block (not per-cue) so
    // the voice stays natural - a single uniform tempo is still applied
    // afterwards to the whole narration.
    const slotEnd = Number(block.nextStart) > block.start
      ? Number(block.nextStart)
      : (videoDuration > 0 ? videoDuration : block.end);
    const slot = Math.max(0.4, slotEnd - block.start);

    const synthesize = async (text) => {
      const tts = await synthesizeSpeech(text, selectedVoice, ttsOptions);
      if (!tts?.buffer?.length) return null;
      const f = path.join(
        TEMP_DIR,
        `dub-tts-${video._id}-${language}-${i}-${Date.now()}.mp3`,
      );
      tempFiles.push(f);
      fs.writeFileSync(f, tts.buffer);
      let d = await getAudioDurationSeconds(f);
      if (!d) d = estimateSpeechSeconds(text, language);
      return { file: f, duration: d };
    };

    let synth = await synthesize(spokenText);
    if (!synth) throw new Error(`TTS returned no audio for sentence ${i + 1}`);

    // Condense only when the natural speech overflows its slot by more than
    // 5%, and only once, to keep the API cost bounded.
    if (videoDuration > 0 && synth.duration > slot * 1.05) {
      const targetChars = Math.max(40, Math.floor(slot * 12));
      try {
        const condensed = await condenseTranslationForDuration({
          text: spokenText,
          targetLanguage: language,
          maxChars: targetChars,
        });
        if (condensed && condensed !== spokenText) {
          const synth2 = await synthesize(condensed);
          if (synth2) {
            synth = synth2;
            spokenText = condensed;
          }
        }
      } catch {
        // keep the original synthesis
      }
    }

    prepared.push({ block, index: i, rawFile: synth.file, duration: synth.duration, spokenText });

    await reportProgress(
      Math.min(60, 35 + Math.round(((i + 1) / blocks.length) * 25)),
    );
  }

  if (prepared.length === 0) {
    throw new Error('Audio timeline assembly produced no clips');
  }

  // Phase 2 - one tempo for the whole narration so the voice stays even.
  const totalSpeech = prepared.reduce((sum, item) => sum + item.duration, 0);
  const tempo = planDubTiming({
    totalSpeechSeconds: totalSpeech,
    videoDuration,
  });
  if (tempo > 1.02) {
    console.log(
      `[dubbing] compressing narration from ${totalSpeech.toFixed(1)}s to fit ${videoDuration}s (tempo ${tempo.toFixed(3)})`,
    );
  }

  // Phase 3 - place the sentences on the timeline.
  let cursor = 0;

  for (let i = 0; i < prepared.length; i += 1) {
    const { block, index, rawFile } = prepared[i];

    // If the previous sentence overflowed we simply continue from the cursor
    // instead of cutting the audio short.
    const startAt = Math.max(block.start, cursor);
    const leadingGap = startAt - cursor;
    if (leadingGap > 0.02) {
      const silenceFile = path.join(
        TEMP_DIR,
        `dub-silence-${video._id}-${index}-${Date.now()}.wav`,
      );
      tempFiles.push(silenceFile);
      if (await createSilenceWav(leadingGap, silenceFile)) {
        clips.push(silenceFile);
        cursor += leadingGap;
      }
    }

    const fittedFile = path.join(
      TEMP_DIR,
      `dub-fit-${video._id}-${language}-${index}-${Date.now()}.wav`,
    );
    tempFiles.push(fittedFile);

    const fittedDuration = await applyTempo(rawFile, fittedFile, tempo);

    clips.push(fittedFile);
    burnSegments.push({
      start: Number(startAt.toFixed(3)),
      end: Number(
        Math.max(
          startAt + 0.6,
          videoDuration > 0 ? Math.min(startAt + fittedDuration, videoDuration) : startAt + fittedDuration,
        ).toFixed(3),
      ),
      text: block.text,
    });
    cursor += fittedDuration > 0 ? fittedDuration : Math.max(0.4, block.end - block.start);

    if (onProgress) {
      try {
        await onProgress(Math.min(90, 60 + Math.round(((i + 1) / prepared.length) * 30)));
      } catch (progressError) {
        // A cancellation must stop the dub; other progress errors are harmless.
        if (progressError?.code === 'DUB_CANCELLED') throw progressError;
      }
    }
  }

  if (videoDuration > cursor + 0.02) {
    const trailingFile = path.join(
      TEMP_DIR,
      `dub-tail-${video._id}-${Date.now()}.wav`,
    );
    tempFiles.push(trailingFile);
    if (await createSilenceWav(videoDuration - cursor, trailingFile)) {
      clips.push(trailingFile);
      cursor = videoDuration;
    }
  }

  if (clips.length === 0) {
    throw new Error('Audio timeline assembly produced no clips');
  }

  const listFile = path.join(TEMP_DIR, `dub-concat-${video._id}-${Date.now()}.txt`);
  tempFiles.push(listFile);
  fs.writeFileSync(
    listFile,
    clips
      .map((file) => `file '${file.replace(/'/g, "'\''")}'`)
      .join('\n'),
  );

  const mergedAudio = path.join(
    TEMP_DIR,
    `dub-merged-${video._id}-${language}-${Date.now()}.wav`,
  );
  tempFiles.push(mergedAudio);

  await runFfmpeg([
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listFile,
    '-c',
    'copy',
    mergedAudio,
  ]);

  const outputFile = path.join(
    TEMP_DIR,
    `dubbed-${video._id}-${language}-${Date.now()}.mp4`,
  );
  tempFiles.push(outputFile);

  // Burn the translated subtitles into the dub so the video is self-contained.
  let subtitleFile = null;
  if (burnSegments.length > 0) {
    subtitleFile = path.join(
      TEMP_DIR,
      `dub-subs-${video._id}-${language}-${Date.now()}.srt`,
    );
    tempFiles.push(subtitleFile);
    fs.writeFileSync(subtitleFile, toSrt(burnSegments), 'utf8');
  }

  const videoArgs = subtitleFile
    ? [
        '-vf',
        // Only the file name is passed (ffmpeg runs inside TEMP_DIR), which
        // avoids Windows drive-letter escaping problems in the filter string.
        `subtitles=${path.basename(subtitleFile)}:force_style='${SUBTITLE_STYLE}'`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
      ]
    : ['-c:v', 'copy'];

  try {
    // Fade the narration out over the last 0.6s so the dub ends smoothly
    // instead of being cut mid-word. The video keeps its original length.
    const fadeStart = Math.max(0, (videoDuration || 0) - 0.6);
    const audioFilter =
      videoDuration > 0
        ? `afade=t=out:st=${fadeStart.toFixed(3)}:d=0.6`
        : null;

    const args = [
      '-y',
      '-i',
      video.publicUrl,
      '-i',
      mergedAudio,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      ...videoArgs,
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      ...(audioFilter ? ['-af', audioFilter] : []),
      '-movflags',
      '+faststart',
      ...(videoDuration > 0
        ? ['-t', String(videoDuration)]
        : ['-shortest']),
      outputFile,
    ];

    await runFfmpeg(args, { cwd: TEMP_DIR });

    const result = await uploadFile(outputFile, {
      resource_type: 'video',
      folder: `${env.cloudinaryFolder}/dubs`,
      use_filename: true,
      unique_filename: true,
      overwrite: false,
    });

    return {
      language,
      url: result.secure_url,
      storagePath: result.public_id,
      durationSeconds: Math.round(result.duration || videoDuration || 0),
      voice: selectedVoice,
      subtitlesBurned: Boolean(subtitleFile),
      segments: burnSegments,
    };
  } finally {
    cleanup([...tempFiles, mergedAudio, outputFile]);
  }
};
