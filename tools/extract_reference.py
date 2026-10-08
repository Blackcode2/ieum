#!/usr/bin/env python3
"""Turn a webcam recording of the lesson motion into hand-landmark data.

The lesson's reference motion is a clean bare-hand re-enactment recorded at the laptop webcam,
because the hand tracker cannot see the clay-coated hands in the artisan clip. This script runs
the same MediaPipe hand model the app uses, on the same centre crop the app tracks, and writes
the result either stretched onto the lesson timeline (the reference) or frame by frame (test tracks).

Setup (once):
    python3 -m venv .venv && .venv/bin/python -m pip install mediapipe
Reference for the app:
    .venv/bin/python tools/extract_reference.py 모범영상.mov public/lesson/reference.json --lesson-frames 169
Raw track of any recording, for tools/coach_check.ts:
    .venv/bin/python tools/extract_reference.py some-take.mov tools/fixtures/some-take.track.json --raw

Note: the Python mediapipe package reports anonymous usage metrics to Google when online.
The web app pins @mediapipe/tasks-vision 0.10.35, which does not.
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

# width / height of the "내 동작" panel in the design; the app tracks the centre crop with this aspect.
VIEW_ASPECT = 1146 / 1027
LESSON_FPS = 30
WARM_UP_CALLS = 5
MAX_BRIDGE_MS = 100


def centre_crop(frame, aspect):
    height, width = frame.shape[:2]
    crop_width = min(width, int(round(height * aspect / 2)) * 2)
    x0 = (width - crop_width) // 2
    return frame[:, x0:x0 + crop_width]


def read_video(path):
    cap = cv2.VideoCapture(path)
    frames, times = [], []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        times.append(cap.get(cv2.CAP_PROP_POS_MSEC))
        frames.append(frame)
    cap.release()
    if not frames:
        sys.exit("no frames could be read from %s" % path)
    return frames, [t - times[0] for t in times]


def track(frames, times, model_path, aspect):
    options = vision.HandLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=model_path),
        running_mode=vision.RunningMode.VIDEO,
        num_hands=2,
    )
    landmarker = vision.HandLandmarker.create_from_options(options)

    def detect(frame, timestamp_ms):
        rgb = np.ascontiguousarray(cv2.cvtColor(centre_crop(frame, aspect), cv2.COLOR_BGR2RGB))
        return landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), timestamp_ms)

    # The first frames after a fresh detection are less accurate; settle the tracker on frame 0 first.
    for i in range(WARM_UP_CALLS):
        detect(frames[0], i)

    tracked = []
    last = WARM_UP_CALLS
    for frame, t in zip(frames, times):
        last = max(int(round(t)) + 1000, last + 1)  # timestamps must increase strictly
        result = detect(frame, last)
        hands = [[[p.x, p.y] for p in hand] for hand in result.hand_landmarks]
        # Left and right are decided by position in the picture, not by the model's label.
        hands.sort(key=lambda pts: sum(p[0] for p in pts))
        entry = {"left": None, "right": None}
        if len(hands) >= 2:
            entry["left"], entry["right"] = hands[0], hands[-1]
        elif len(hands) == 1:
            side = "left" if sum(p[0] for p in hands[0]) / 21 < 0.5 else "right"
            entry[side] = hands[0]
        tracked.append(entry)
    landmarker.close()
    return tracked


def interpolate(times, tracked, side, t):
    """Landmarks of one hand at source time t, or None if it was not tracked near t."""
    after = int(np.searchsorted(times, t))
    before = max(after - 1, 0)
    after = min(after, len(times) - 1)
    a, b = tracked[before][side], tracked[after][side]
    if a is not None and b is not None:
        span = times[after] - times[before]
        w = 0.0 if span <= 0 else (t - times[before]) / span
        return [[pa[0] + (pb[0] - pa[0]) * w, pa[1] + (pb[1] - pa[1]) * w] for pa, pb in zip(a, b)]
    for index, points in ((before, a), (after, b)):
        if points is not None and abs(times[index] - t) <= MAX_BRIDGE_MS:
            return points
    return None


def rounded(points):
    return None if points is None else [[round(x, 4), round(y, 4)] for x, y in points]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("video")
    parser.add_argument("output")
    parser.add_argument("--model", default=os.path.join(os.path.dirname(__file__), "..", "public", "mediapipe", "hand_landmarker.task"))
    parser.add_argument("--lesson-frames", type=int, help="stretch the recording onto this many lesson frames at 30 fps")
    parser.add_argument("--raw", action="store_true", help="write one entry per recorded frame instead")
    args = parser.parse_args()
    if args.raw == bool(args.lesson_frames):
        parser.error("give either --lesson-frames N or --raw")

    frames, times = read_video(args.video)
    tracked = track(frames, times, args.model, VIEW_ASPECT)
    both = sum(1 for e in tracked if e["left"] and e["right"])
    print("%s: %d frames, %.2f s, both hands in %.1f%%" % (os.path.basename(args.video), len(frames), times[-1] / 1000, 100 * both / len(frames)))

    if args.raw:
        out_frames = [{"t": round(t, 1), "left": rounded(e["left"]), "right": rounded(e["right"])} for t, e in zip(times, tracked)]
        lesson = None
    else:
        n = args.lesson_frames
        step = 1000 / LESSON_FPS
        # Linear stretch: the recording's first and last frames land on the lesson's first and last frames.
        out_frames = []
        for i in range(n):
            source_t = times[-1] * i / (n - 1)
            out_frames.append({
                "t": round(i * step, 1),
                "left": rounded(interpolate(times, tracked, "left", source_t)),
                "right": rounded(interpolate(times, tracked, "right", source_t)),
            })
        lesson = {"fps": LESSON_FPS, "frameCount": n, "durationMs": round(n * step, 1)}
        missing = sum(1 for f in out_frames if not (f["left"] and f["right"]))
        print("stretched %.2f s onto %d lesson frames (%.2f s); frames without both hands: %d" % (times[-1] / 1000, n, n * step / 1000, missing))

    data = {
        "version": 1,
        "source": os.path.basename(args.video),
        "note": "맨손 재연 기록. Bare-hand re-enactment at the webcam, not extracted from the artisan clip.",
        "view": {"aspect": round(VIEW_ASPECT, 5), "coordinates": "normalised to the centre crop of the camera frame; x right, y down; not mirrored"},
        "lesson": lesson,
        "frames": out_frames,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    print("wrote %s (%.0f KB)" % (args.output, os.path.getsize(args.output) / 1024))


if __name__ == "__main__":
    main()
