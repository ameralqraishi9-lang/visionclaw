# Hands-free practice study

This branch adds an iOS study mode to VisionClaw. Start one session, keep the
complete practice question and all choices in view, and the app requests an
explanation automatically. No spoken or typed question prompt is needed.

**Source code is not an installed iPhone app.** An Apple-signed build and
on-device verification are still required. A GitHub fork or an unsigned simulator
build cannot be installed directly on an iPhone.

## Behavior after installation

1. Open **Hands-free study → AI setup**, enter your own Gemini API key and save it.
2. Connect your glasses through Meta AI with the required developer access.
3. Tap **Start study session** for permitted, ungraded practice.
4. Hold the full question steady. The answer and rationale appear on the phone
   and, if the Meta Display capability connects, on the lens.
5. Move to a new question to continue automatically. **Stop study session** ends
   camera processing and cancels pending AI requests.

The mode is accessible without the original project's private pilot access code.
It calls Google Gemini directly using the user's own API account. It does not
use or bypass the private gateway. The original voice assistant remains available
through a separate button and retains its existing access requirements.

## Current limits

- Keep the app foregrounded; switching apps, locking the phone or receiving an
  interruption pauses the session. Auto-lock is disabled only during a session.
- English OCR samples the decoded camera stream at most every 0.8 seconds.
  Matching observations spanning at least 1.2 seconds are required.
- This version uses video frames, not automatic high-resolution still capture.
  Small print, glare, partial choices, multi-column questions and diagrams need
  hardware testing. The AI is asked to withhold answers for incomplete images.
- Recognition is conservative: the lowest OCR confidence must be at least 0.8.
  OCR confidence does not guarantee that text or an AI answer is correct.
- Identical recognized text is attempted once per session, with at least eight
  seconds between requests. Changes to doses, units, negation and choices are
  preserved rather than fuzzy-matched away.
- A session allows at most 30 requests and lasts at most 30 minutes. **Retry
  visible question** retries explicitly and counts toward the same request limit.
- Responses for a changed or stale view are discarded; the old answer clears
  when visible text changes or frames stop. Physical display timing needs testing.
- Optional speech uses the iPhone's current audio route. Bluetooth routing and
  camera/display concurrency need a real-device test.
- Use only for authorized practice. The prompt declines visibly identified
  graded/timed/proctored assessments, but detection cannot prove permission.
- AI explanations may be wrong. Check nursing answers against course materials;
  this app is not a clinical decision tool.

## Privacy and credentials

Only candidate question images and their OCR text are sent to Google, at the
request cadence above. API usage may incur charges. No camera stream, microphone
audio, or study content is sent to VisionClaw's private pilot gateway in this mode.
The mode does not save question images or log recognized text. The personal
API key is stored in Keychain, available only when this device is unlocked, and
can be removed in AI setup. Provider-side retention is governed by the user's
Google API account terms.

## Build and verification

- Meta DAT stays pinned to **0.9.0**. MWDATDisplay is linked explicitly.
- Camera and display share one DeviceSession.
- Run **swift test** at the repository root for deterministic core tests.
- The **Study mode checks** GitHub Actions workflow runs those tests and an
  unsigned iOS simulator build. Forks may require enabling GitHub Actions.
- The older camera test suite is not claimed as validated: it references mock
  SDK APIs removed before DAT 0.9.0. The new core tests do not import that suite.
- Neither a simulator build nor core tests verify real optics, registration,
  Bluetooth routing, API access, or lens rendering.

### Physical acceptance checks

Use a personal API key and ungraded sample material. Verify registration, camera
permission denial, one readable MCQ, a multiple-answer question, unreadable or
cropped choices, question changes while a request is pending, repetition without
new requests, API failure/retry, disconnect/reconnect, stopping mid-request, and
backgrounding. Confirm the lens clears rather than leaving an old answer.
Verify optional audio separately. Do not describe the integration as working
end-to-end until these checks pass.

## Phone-only installation

The code can be reviewed and cloud builds monitored from an iPhone. An
installable native app still requires a legitimate Apple signing/distribution
route and any required Meta developer access. Cloud signing or TestFlight needs
the owner's account setup; this branch does not create accounts, provision
certificates, upload a release, or install anything on the phone. Meta also
distinguishes experimental capabilities from publishable ones; check current
Meta requirements before selecting a distribution route.

## Primary references

- [Meta iOS SDK](https://github.com/facebook/meta-wearables-dat-ios)
- [Meta SDK changelog](https://github.com/facebook/meta-wearables-dat-ios/blob/main/CHANGELOG.md)
- [Meta Display sample](https://github.com/facebook/meta-wearables-dat-ios/tree/main/samples/DisplayAccess)
- [Gemini Generate Content API](https://ai.google.dev/api/generate-content)
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)
