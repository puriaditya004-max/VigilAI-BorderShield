"""
OpenCV number-plate localization runtime.

Reads a full frame and emits JSON:
  {"plates": [{"bbox": [x1, y1, x2, y2], "confidence": 0.42, "quality": {"sharpness": 0.2}}]}

This script proposes candidate plate regions only. It does not read, infer,
or fabricate plate text; OCR remains a separate configured runtime.

Install for real use:
  pip install opencv-python
"""

import argparse
import json
import sys


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True, help="Frame image path")
    parser.add_argument("--min-area", type=float, default=600.0)
    parser.add_argument("--max-candidates", type=int, default=5)
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
        filtered = cv2.bilateralFilter(gray, 9, 75, 75)
        edged = cv2.Canny(filtered, 60, 180)
        contours, _ = cv2.findContours(edged, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        candidates = []
        frame_area = max(1, image.shape[0] * image.shape[1])

        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            area = float(w * h)
            if area < args.min_area or h <= 0:
                continue
            aspect_ratio = w / float(h)
            if aspect_ratio < 2.0 or aspect_ratio > 6.5:
                continue

            roi = gray[y:y + h, x:x + w]
            sharpness = float(cv2.Laplacian(roi, cv2.CV_64F).var()) / 1000.0 if roi.size else 0.0
            area_score = min(1.0, area / (frame_area * 0.08))
            aspect_score = max(0.0, 1.0 - abs(aspect_ratio - 4.0) / 3.0)
            confidence = round(max(0.05, min(0.9, 0.25 + area_score * 0.25 + aspect_score * 0.25 + min(sharpness, 1.0) * 0.15)), 3)
            candidates.append({
                "bbox": [int(x), int(y), int(x + w), int(y + h)],
                "confidence": confidence,
                "quality": {"sharpness": round(sharpness, 3)}
            })

        candidates.sort(key=lambda item: item["confidence"], reverse=True)
        print(json.dumps({"plates": candidates[:max(0, args.max_candidates)]}), flush=True)
    except Exception as exc:
        print(f"OpenCV plate detector failed for image={args.image}: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
