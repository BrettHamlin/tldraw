---
title: Presenter canvas
component: ./PresenterCanvasExample.tsx
priority: 5
keywords: [presentation, playback, pressure, drawing, sequence]
---

Play a prepared explanation as progressively drawn, editable native strokes in a separate audience window.

---

Open the audience window, share only that window, and keep the presenter view focused. Use **Space** or **Right arrow** to start the next beat, and **P** to pause or resume. Buttons provide the same controls. Each beat stops automatically for narration. Reset returns the prepared drawing to its blank starting state; start the first beat again to replay.

The audience uses the `/presenter-canvas/full?audience=1` route, without the example site wrapper or presenter controls. Open it from the presenter button so its same-origin opener can send commands. Hotkeys belong to the presenter view, not the audience window or other apps. Allow pop-ups if the browser blocks the audience window.

`prepared.ts` owns the sample explanation and its timing. `PreparedPlayback` advances a local clock independently of AI or network calls. The audience owns this clock; the presenter sends discrete commands using `postMessage`, checked against the opener and origin. Leaving or reloading the presenter pauses playback. Reloading the presenter reconnects to the same audience canvas and restores its current cue; strokes and manual edits remain in that audience window. A session ID retained in the presenter tab, same-origin checks, and opener/source checks bind the connection. Missing audience heartbeats disconnect the controls after about two seconds (background browser throttling may delay this). If the audience navigates away, **Open replacement audience** explicitly opens a fresh rehearsal without navigating or closing the previous window; share the replacement window in your call. Closing the audience discards its unsaved canvas. Reloading the audience starts a fresh rehearsal. Closing and reopening the presenter tab does not restore its previous session.

Native `draw` shapes use `isPen: true` with three-dimensional encoded points, where `z` carries pressure. Playback extends their segments and marks each stroke complete at its end. Finished strokes remain selectable and editable with the native select tool; playback does not revisit completed beats. Reset removes only prepared shapes, preserving any other shapes added to the canvas. Playback updates do not fill the undo stack.

This is canned sample content, not an AI authoring integration. No microphone, MCP host, deployment, or native input injection is involved.
