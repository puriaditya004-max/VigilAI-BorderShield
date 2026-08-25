"""
BorderShield vision runtime scaffold.

This adapts the useful VigilAI YOLO/ByteTrack pattern into a production boundary:
read video/RTSP frames, detect person/vehicle objects, and emit TrackEvent JSON lines.

Usage:
  python edge/vision-runtime/python/yolo_track_runtime.py --source 0
  python edge/vision-runtime/python/yolo_track_runtime.py --source sample.mp4

Dependencies for real runtime:
  pip install ultralytics opencv-python
"""

import argparse
import hashlib
import json
import os
import time
from datetime import datetime, timezone


PERSON_CLASS_ID = 0
VEHICLE_CLASS_IDS = {2, 3, 5, 7}


def iso_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="0", help="OpenCV source: camera index, video file, or RTSP URL")
    parser.add_argument("--camera-id", default="cam-bop-01-east")
    parser.add_argument("--model", default="yolov8n.pt")
    parser.add_argument("--confidence", type=float, default=0.45)
    parser.add_argument("--max-frames", type=int, default=0, help="0 means run until source ends")
    parser.add_argument("--keyframe-dir", default="", help="Optional directory for annotated keyframe JPEGs")
    return parser.parse_args()


def object_class(class_id):
    if class_id == PERSON_CLASS_ID:
        return "PERSON"
    if class_id in VEHICLE_CLASS_IDS:
        return "VEHICLE"
    return None


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def track_event(camera_id, detection, model_name, frame_meta=None):
    x1, y1, x2, y2 = detection["xyxy"]
    capture_time = iso_now()
    track_id = str(detection.get("track_id", f"{detection['class_id']}-{int(x1)}-{int(y1)}"))
    bbox = {"x": x1, "y": y1, "width": x2 - x1, "height": y2 - y1}
    footpoint = {"x": bbox["x"] + bbox["width"] / 2, "y": bbox["y"] + bbox["height"], "t": capture_time}

    event = {
        "schemaVersion": "track-event.v1",
        "eventId": f"evt-track-{camera_id}-{track_id}-{int(time.time() * 1000)}",
        "cameraId": camera_id,
        "trackId": track_id,
        "objectClass": object_class(detection["class_id"]),
        "confidence": round(float(detection["confidence"]), 3),
        "bbox": bbox,
        "trajectory": [footpoint],
        "captureTime": capture_time,
        "model": {
            "name": model_name,
            "version": "runtime-local",
            "checksum": "sha256:unverified-local-model"
        }
    }
    if frame_meta:
        event["frame"] = frame_meta
    return event


def main():
    args = parse_args()

    try:
        import cv2
        from ultralytics import YOLO
    except ImportError as exc:
        raise SystemExit(f"Missing runtime dependency: {exc}. Install ultralytics and opencv-python.") from exc

    source = int(args.source) if args.source.isdigit() else args.source
    model = YOLO(args.model)
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise SystemExit(f"Could not open source: {args.source}")

    frame_count = 0
    while True:
      ok, frame = cap.read()
      if not ok:
          break

      frame_count += 1
      results = model.track(frame, persist=True, verbose=False, conf=args.confidence)[0]
      if results.boxes is None:
          continue

      has_ids = results.boxes.id is not None
      for box in results.boxes:
          class_id = int(box.cls[0])
          if object_class(class_id) is None:
              continue

          detection = {
              "class_id": class_id,
              "confidence": float(box.conf[0]),
              "xyxy": [float(v) for v in box.xyxy[0]]
          }
          if has_ids and box.id is not None:
              detection["track_id"] = int(box.id[0])

          frame_meta = None
          if args.keyframe_dir:
              os.makedirs(args.keyframe_dir, exist_ok=True)
              x1, y1, x2, y2 = map(int, detection["xyxy"])
              annotated = frame.copy()
              cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 0, 255), 2)
              cv2.putText(annotated, object_class(class_id), (x1, max(20, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
              keyframe_path = os.path.abspath(os.path.join(args.keyframe_dir, f"{args.camera_id}-{frame_count}-{int(time.time() * 1000)}.jpg"))
              cv2.imwrite(keyframe_path, annotated)
              frame_meta = {"uri": f"file://{keyframe_path.replace(os.sep, '/')}", "sha256": sha256_file(keyframe_path)}

          print(json.dumps(track_event(args.camera_id, detection, args.model, frame_meta)), flush=True)

      if args.max_frames and frame_count >= args.max_frames:
          break

    cap.release()


if __name__ == "__main__":
    main()
