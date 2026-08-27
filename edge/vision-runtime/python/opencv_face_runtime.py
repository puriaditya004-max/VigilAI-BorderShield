"""
OpenCV face-detection runtime for privacy redaction candidates.

Reads an image/frame and emits JSON:
  {"faces": [{"bbox": [x1, y1, x2, y2], "confidence": 0.6}]}

This performs detection only. It does not create identity embeddings,
face recognition matches, names, or person IDs.

Install for real use:
  pip install opencv-python
"""

import argparse
import json
import sys


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True, help="Frame image path")
    parser.add_argument("--scale-factor", type=float, default=1.1)
    parser.add_argument("--min-neighbors", type=int, default=5)
    return parser.parse_args()


def main():
    args = parse_args()
    try:
        import cv2
    except ImportError as exc:
        raise SystemExit(f"Missing OpenCV dependency: {exc}") from exc

    try:
        image = cv2.imread(args.image)
        if image is None:
            raise RuntimeError(f"Could not read image: {args.image}")

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        detector = cv2.CascadeClassifier(cascade_path)
        if detector.empty():
            raise RuntimeError(f"OpenCV Haar cascade unavailable: {cascade_path}")

        faces = detector.detectMultiScale(
            gray,
            scaleFactor=args.scale_factor,
            minNeighbors=args.min_neighbors
        )
    except Exception as exc:
        print(f"OpenCV face detector failed for image={args.image}: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc

    results = []
    for x, y, w, h in faces:
        results.append({
            "bbox": [int(x), int(y), int(x + w), int(y + h)],
            "confidence": 0.6
        })

    print(json.dumps({"faces": results}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc
