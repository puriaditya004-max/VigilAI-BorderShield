"""
PaddleOCR plate-crop runtime.

Reads a cropped number-plate image and emits JSON:
  {"results": [{"text": "...", "confidence": 0.92}]}

Install for real use:
  pip install paddleocr paddlepaddle
"""

import argparse
import json
import sys


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True, help="Plate crop image path")
    parser.add_argument("--lang", default="en")
    return parser.parse_args()


def main():
    args = parse_args()
    try:
        from paddleocr import PaddleOCR
    except ImportError as exc:
        raise SystemExit(f"Missing PaddleOCR dependency: {exc}") from exc

    ocr = PaddleOCR(use_angle_cls=True, lang=args.lang, show_log=False)
    output = ocr.ocr(args.image, cls=True)
    results = []

    for page in output or []:
        for row in page or []:
            if len(row) < 2:
                continue
            text, confidence = row[1]
            results.append({"text": text, "confidence": float(confidence)})

    print(json.dumps({"results": results}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc
