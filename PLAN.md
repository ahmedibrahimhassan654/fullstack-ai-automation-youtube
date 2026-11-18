# Dubbing Pipeline — Current Flow & Improvement Plan (Draft)

## Summary
- **Task:** Document how dubbing works today in `ai-youtube-video-sass` and propose a prioritized, system-coherent plan to improve dubbing quality and reliability.
- **Chosen planning principle (per request):** Arabic is the default evaluation language for the product owner. Any quality bar accepted as "good" in Arabic must be generalized and implemented for all supported dubbing languages (not as Arabic-only hacks), while allowing language-specific data/config where appropriate.

## Context (how dubbing works today)

### End-to-end flow
1. **Entry points**
   - Single video dub: `POST /api/videos/:id/dub` (`backend/src/routes/video.routes.js` -> `dubVideo` in `backend/src/controllers/video.controller.js`). Responds `202`, sets `video.dubbing` to processing, runs `runDubbing(...)` async.
   - Cancel: `POST /api/videos/:id/dub/cancel` (marks failed/cancelled; worker cooperatively stops at progress checks).
   - Delete dub: `DELETE /api/videos/:id/dub?language=&voice=`.
   - Translate-only refresh: `POST /api/videos/:id/translate`.
   - Course bulk dub (frontend-orchestrated, sequential): `frontend/src/app/courses/[id]/client.tsx` `generateMissingDubs()` starts each missing lesson dub via API and polls `GET /api/videos/:id` until completed/failed, then continues.
   - Progress/events: SSE `GET /api/videos/:id/events` / global events via `backend/src/lib/progressBus.js` and `emitVideoProgress`.

2. **Pre-dub translation readiness (`runDubbing`, `video.controller.js`)**
   - Requires timed `transcriptSegments` and usable target translation when target != original.
   - Reuses stored translation only if complete (no untranslated segments) and every segment has non-empty `spokenText`; otherwise re-translates via `translateTranscriptSegments` (`backend/src/services/aiMetadata.service.js`).
   - Validates completeness with `findUntranslatedSegments`; fails with `502 TRANSLATION_FAILED` if incomplete.
   - Caches repaired/translated segments into `video.translations` and emits progress (~8–32%).

3. **Dub generation (`generateDubbedVideo`, `backend/src/services/dubbing.service.js`)**
   - Loads/validates translation segments (`getTranslationSegments`) and normalizes timing to video duration.
   - Merges subtitle cues into sentence blocks (`mergeCuesIntoSentences`) to reduce cue-by-cue rushing/cuts.
   - Selects provider/voice once per dub (Edge/Google/ElevenLabs heuristics) and synthesizes each block (natural speech), measuring duration.
   - Plans **single global tempo** (`planDubTiming`, cap `MAX_TEMPO=1.3`) and applies uniformly (`applyTempo`) when narration exceeds available duration.
   - Assembles timeline: place at `max(block.start, cursor)` with leading/trailing silence, advance cursor by fitted duration (overflow drifts forward). Builds burned subtitle cues/SRT from fitted narration chunks.
   - Mux with ffmpeg: replace audio track, burn subtitles (re-encode video) when present, fade-out tail, trim to source duration, store output (Cloudinary/local via `storage.service.js`), upsert `video.dubs`.

4. **Translation/spoken-text quality layer (`aiMetadata.service.js`)**
   - Batch translation with retries/splitting, script/language validation, technical-term normalization/repair (`technicalTerms.service.js`), and resilience for technical/untranslatable single segments.
   - Optional evaluation/second-opinion/refinement loops (quality scoring, Arabic tashkeel retry conditions, spoken-version generation for non-Latin targets, Arabic number spelling, spoken refinement) depending on fast/quality paths.
   - Provider routing/fallback/cooldown across configured AI providers (Groq/Gemini/DeepSeek/CrowLLM/Ollama availability).

5. **TTS layer (`backend/src/services/tts.service.js`)**
   - Supports Edge TTS, ElevenLabs (with timestamps/alignment path), Google TTS; chunking/retries/trim of Edge padding; mixed-script synthesis helpers exist.
   - Current defaults: `VOICES.ar = ar-XA-Standard-B`, `VOICES.es = es-ES-Standard-A` (backend); frontend prefers Google Standard defaults for ar/es in voice pickers.

6. **Data/state**
   - `backend/src/models/Video.js`: `dubbing` job state, `translations[]` (segments incl. `text`, `spokenText`, quality fields), `dubs[]` (`language,url,storagePath,storageProvider,durationSeconds,voice,subtitlesBurned,createdAt`), lesson/publish metadata.

### Key files
- `backend/src/controllers/video.controller.js` — dub/translate/cancel/delete orchestration, progress/events, translation preflight/cache.
- `backend/src/services/dubbing.service.js` — segmentation-to-sentence merge, TTS per block, global timing/tempo, subtitle cue generation/burn, ffmpeg mux, storage.
- `backend/src/services/tts.service.js` — providers/voices, chunking, retries, trimming/alignment primitives, mixed-script helpers.
- `backend/src/services/aiMetadata.service.js` — translation, validation, spoken text, quality/refinement, provider fallback/cooldown.
- `backend/src/services/technicalTerms.service.js` — term protection/repair/transliteration helpers.
- `backend/src/services/storage.service.js` — local/cloud storage, local fallback behavior.
- `backend/src/models/Video.js` — schema/contracts.
- `frontend/src/app/videos/[id]/client.tsx` — dub UI, voice defaults, progress, dub list/actions.
- `frontend/src/app/courses/[id]/client.tsx` — sequential course bulk dubbing.

## Observed strengths and current limitations (from code)

### Strengths
- Whole-sentence block merging (better than per-cue synthesis) and single global tempo strategy to reduce inconsistent speedups.
- Translation safeguards: reuse checks, untranslated detection, spokenText requirement, technical-term repair, provider fallback/cooldown mechanisms.
- Progress reporting across translation and rendering phases; cooperative cancellation checks.

### Limitations / improvement opportunities
1. **Timing & sync fidelity**
   - Uniform global tempo + `max(block.start, cursor)` can accumulate drift/overflow; output is trimmed to video duration (`-t`) so tail audio may be cut in edge cases.
   - No per-block adaptive fit beyond global cap; `condenseTranslationForDuration` exists but not integrated into dubbing fit strategy.
   - Subtitle burn cue timing is weighted by text/chars over fitted duration, not aligned to actual TTS word timings.

2. **Pronunciation / spoken naturalness (critical for "Arabic bar" -> all languages)**
   - Dubbing path calls Edge synthesis with `mixedScript:false` and uses one provider/voice pipeline; mixed-script pronunciation helpers and TTS timing metadata are underutilized for alignment/pronunciation.
   - SSML control is minimal (rate/pitch only in places); no phoneme/lexicon/pronunciation dictionaries or configurable per-language prosody profiles.
   - Spoken-text quality depends heavily on translation pipeline outputs; fast/quality behavior and thresholds are partly hardcoded.

3. **Translation completeness & resilience**
   - Incomplete/untranslatable handling improved recently, but validation is heuristic and error messages/details vary by layer.
   - In-memory provider cooldown/disable state is process-local; no persisted/structured failure diagnostics per segment/provider.

4. **Audio/subtitle output quality**
   - Original audio replaced entirely (no background preservation/ducking options).
   - Burned subtitle style/wrapping/tashkeel behavior mostly fixed; not configurable per language/product need.
   - Re-encode on subtitle burn impacts quality/time; generated cue metadata not persisted for QA.

5. **Operations & UX**
   - Cloudinary configuration gate in dubbing service can block local-only setups despite local storage support elsewhere.
   - Course bulk dub is client-driven polling (fragile if tab closes); no server-side queue/job orchestration.
   - Local dub file cleanup on delete and temp-file hygiene can be improved.

## System Impact (for planned improvements)
- **Source of truth:** timed source transcript/segments + target translation segments (`text` for display/subtitles, `spokenText` for narration) must remain coherent; dub timing/subtitles must derive from the same approved segment/timing model.
- **State/lifecycle:** `video.dubbing` (job), `video.translations` (cache/quality), `video.dubs` (artifacts) must stay consistent across retries/cancel/failure/resume-like re-runs; progress semantics should distinguish translation vs synthesis vs render.
- **Cross-cutting dependencies:** changes affect backend pipeline, provider integrations, storage, publish flows (dub reuse), and frontend progress/default voice UX.
- **Generalization rule:** define a language-agnostic "dub quality contract/checklist" (validated first in Arabic) and implement via configurable per-language profiles/data (voices, prosody, script/pronunciation rules), not one-off Arabic branches.

## Proposed approach (draft, pending clarification)

### Phase 0 — Define the quality bar and measurement (Arabic baseline, global contract)
- Capture user-approved Arabic acceptance criteria as an explicit checklist (e.g. meaning fidelity, term/pronunciation correctness, pacing/naturalness, sync, subtitle readability/timing, no truncation/missing segments).
- Add/standardize a way to evaluate the same criteria on other languages (automated checks where possible + manual review checklist/artifacts).
- **Why first:** prevents local fixes that improve Arabic but regress system behavior elsewhere.

### Phase 1 — Reliability & observability of the current pipeline
- Normalize translation/dub error codes and persist structured diagnostics (failed segment indices, provider, retry counts, reason).
- Harden completion semantics (no silent tail truncation, clearer progress states, better cancellation/cleanup behavior).
- Align storage/provider assumptions (local vs Cloudinary) and delete/local cleanup behavior.

### Phase 2 — Spoken quality & pronunciation (generalized from Arabic-approved bar)
- Improve spoken-text generation/pronunciation pipeline for all languages with language profiles (technical terms, numerals, acronyms, mixed-script handling).
- Tune TTS strategy per language/provider (prosody/rate/chunking/voice fallbacks) with config-driven defaults and safe fallbacks.
- Reuse/enable TTS timing metadata where available to improve naturalness diagnostics and subtitle alignment.

### Phase 3 — Timing/sync and subtitle quality
- Introduce adaptive fit strategy: detect overflow/underflow per block, prefer controlled text condensation/stretch/compression policies before hard trim, and report sync risk.
- Generate burned subtitle cues from more accurate timing sources (TTS/aligned cues) while preserving readable wrapping/style; make key subtitle behaviors configurable.
- Verify no mid-word/sentence truncation at output boundary.

### Phase 4 — Product/scale improvements (optional, based on priority)
- Move course bulk dubbing orchestration toward server-side queued jobs for resumability and tab-close safety.
- Add QA tooling/views (per-dub diagnostics, segment-level playback checks, compare voices/providers).

## Candidate file-level changes (to refine after clarification)
- `backend/src/services/dubbing.service.js` — adaptive timing/fit, subtitle cue timing source, mux/trim safeguards, progress/error detail hooks.
- `backend/src/services/aiMetadata.service.js` — configurable quality/fast modes, structured validation failures, stronger/generalized spoken/pronunciation passes.
- `backend/src/services/tts.service.js` — provider/voice/prosody profiles, mixed-script/pronunciation strategy integration, expose timing data consistently.
- `backend/src/services/technicalTerms.service.js` — extensible term/pronunciation rules per language/domain.
- `backend/src/controllers/video.controller.js` — unified preflight/job state/error reporting; avoid semantic overload of dubbing state for translate-only flows.
- `backend/src/models/Video.js` — optional fields for diagnostics/quality artifacts/cue metadata (only if needed).
- `frontend/src/app/videos/[id]/client.tsx`, `frontend/src/app/courses/[id]/client.tsx` — clearer progress/errors, QA affordances, bulk orchestration UX aligned with backend behavior.

## Verification (planned)
- **Automated:** targeted backend tests for translation validation/completeness, timing planning, subtitle cue generation, and dub state transitions; regression checks for existing dubbing endpoints.
- **End-to-end (Arabic baseline):** run dub on representative Arabic samples (technical terms, numbers, mixed script, long/short segments), confirm accepted criteria.
- **Cross-language parity:** run same checklist on at least 2–3 other target languages (including Spanish default) to ensure the accepted Arabic bar maps to language-appropriate quality.
- **Operational checks:** cancel/retry behavior, progress accuracy, storage/output correctness, publish/playback, no temp/output leaks.

## Clarified acceptance criteria (user input)
- **Yellow/burned subtitles:** keep commands/tools/technical/scientific terms **as-is in English** (e.g. `OpenVPN`, `sudo`, `UDP`, paths/flags) — not transliterated into Arabic script in subtitle text.
- **Pronunciation:** pronounce those English terms **correctly and clearly in English** during dubbing, aiming to keep the **same tone/speaker voice** as the selected voice ID (current default case: Google TTS, e.g. Arabic `ar-XA-Standard-B`).
- **Timing/reference:** use the uploaded timed `.srt/.vtt` as the dubbing reference; translate/dub the spoken content and keep subtitle text/timing aligned to the intended spoken sentence times as accurately as possible (minimize drift/cuts).
- **Generalization rule:** once this bar is accepted in Arabic, apply the same behavior/quality contract to all dubbing languages.

## Clarifications still needed before finalizing implementation plan
1. **Reference examples:** أمثلة محددة من فيديو مرجعي (الكلمة/الأمر + الوقت التقريبي + النطق/الكتابة الحاليين + الشكل الصحيح المطلوب).
2. **Priority:** نبدأ بتحسين **نطق وكتابة المصطلحات التقنية** أولاً، أم التزامن الزمني مع SRT، أم كليهما معاً؟
3. **Constraints:** الالتزام بـ Google TTS الحالي فقط أم تجربة مسارات/أصوات بديلة إذا لزم لتحسين النطق مع الحفاظ على نفس الطابع؟
4. **Scope:** تنفيذ المرحلة الأولى الآن بعد اعتماد الخطة التفصيلية (ملفات/تغييرات/اختبارات) أم إعداد خطة تنفيذ فقط؟
