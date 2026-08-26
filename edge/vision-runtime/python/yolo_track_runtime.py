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
import sys
import time
from datetime import datetime, timezone


PERSON_CLASS_ID = 0
VEHICLE_CLASS_IDS = {2, 3, 5, 7}
ZONE_FRAME_WIDTH = 1280
ZONE_FRAME_HEIGHT = 720
CAP_PROP_FRAME_WIDTH = 3
CAP_PROP_FRAME_HEIGHT = 4


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


def configure_capture_resolution(cap, width=ZONE_FRAME_WIDTH, height=ZONE_FRAME_HEIGHT):
    cap.set(CAP_PROP_FRAME_WIDTH, width)
    cap.set(CAP_PROP_FRAME_HEIGHT, height)
    actual_width = int(cap.get(CAP_PROP_FRAME_WIDTH) or 0)
    actual_height = int(cap.get(CAP_PROP_FRAME_HEIGHT) or 0)
    return {
        "requested": {"width": width, "height": height},
        "actual": {"width": actual_width, "height": actual_height},
        "matches_zone_geometry": actual_width == width and actual_height == height
    }


def build_coordinate_transform(source_width, source_height, canonical_width=ZONE_FRAME_WIDTH, canonical_height=ZONE_FRAME_HEIGHT):
    source_width = int(source_width or 0)
    source_height = int(source_height or 0)
    canonical_width = int(canonical_width or 0)
    canonical_height = int(canonical_height or 0)
    if source_width <= 0 or source_height <= 0 or canonical_width <= 0 or canonical_height <= 0:
        return {
            "valid": False,
            "reason": "INVALID_FRAME_DIMENSIONS",
            "source": {"width": source_width, "height": source_height},
            "canonical": {"width": canonical_width, "height": canonical_height}
        }

    scale = min(canonical_width / source_width, canonical_height / source_height)
    scaled_width = source_width * scale
    scaled_height = source_height * scale
    pad_x = (canonical_width - scaled_width) / 2
    pad_y = (canonical_height - scaled_height) / 2
    return {
        "valid": True,
        "mode": "aspect_fit_letterbox",
        "source": {"width": source_width, "height": source_height},
        "canonical": {"width": canonical_width, "height": canonical_height},
        "scale": scale,
        "padding": {"x": pad_x, "y": pad_y}
    }


def transform_point(point, transform):
    return {
        "x": point["x"] * transform["scale"] + transform["padding"]["x"],
        "y": point["y"] * transform["scale"] + transform["padding"]["y"]
    }


def transform_bbox(bbox, transform):
    top_left = transform_point({"x": bbox["x"], "y": bbox["y"]}, transform)
    return {
        "x": top_left["x"],
        "y": top_left["y"],
        "width": bbox["width"] * transform["scale"],
        "height": bbox["height"] * transform["scale"]
    }


def log_capture_resolution(resolution, stream=sys.stderr):
    print(
        "Capture resolution requested="
        f"{resolution['requested']['width']}x{resolution['requested']['height']} "
        "actual="
        f"{resolution['actual']['width']}x{resolution['actual']['height']} "
        f"matches_zone_geometry={str(resolution['matches_zone_geometry']).lower()}",
        file=stream,
        flush=True
    )


def track_event(camera_id, detection, model_name, frame_meta=None):
    x1, y1, x2, y2 = detection["xyxy"]
    capture_time = iso_now()
    track_id = str(detection.get("track_id", f"{detection['class_id']}-{int(x1)}-{int(y1)}"))
    source_bbox = {"x": x1, "y": y1, "width": x2 - x1, "height": y2 - y1}
    transform = detection.get("coordinate_transform")
    bbox = transform_bbox(source_bbox, transform) if transform and transform.get("valid") else source_bbox
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
    if transform:
        event["coordinateSpace"] = transform
        event["sourceBbox"] = source_bbox
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
    resolution = configure_capture_resolution(
        cap,
        width=ZONE_FRAME_WIDTH,
        height=ZONE_FRAME_HEIGHT
    )
    log_capture_resolution(resolution)

    frame_count = 0
    while True:
      ok, frame = cap.read()
      if not ok:
          break

      frame_count += 1
      source_height, source_width = frame.shape[:2]
      coordinate_transform = build_coordinate_transform(source_width, source_height)
      if not coordinate_transform["valid"]:
          print(
              f"Skipping frame {frame_count}: {coordinate_transform['reason']} "
              f"source={source_width}x{source_height}",
              file=sys.stderr,
              flush=True
          )
          continue

      if frame_count == 1 and (source_width != ZONE_FRAME_WIDTH or source_height != ZONE_FRAME_HEIGHT):
          print(
              "Coordinate transform active "
              f"source={source_width}x{source_height} "
              f"canonical={ZONE_FRAME_WIDTH}x{ZONE_FRAME_HEIGHT} "
              f"mode={coordinate_transform['mode']} "
              f"scale={coordinate_transform['scale']:.6f} "
              f"padding={coordinate_transform['padding']['x']:.2f},{coordinate_transform['padding']['y']:.2f}",
              file=sys.stderr,
              flush=True
          )

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
              "xyxy": [float(v) for v in box.xyxy[0]],
              "coordinate_transform": coordinate_transform
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
