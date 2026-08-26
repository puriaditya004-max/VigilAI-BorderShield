# model-registry

Model cards and promotion metadata.
Champion/challenger versioning, signed model checksums, rollback versions.

## Promotion Gate

No model is production-promoted until a model card records:

- model file name and immutable checksum
- training dataset manifest
- validation dataset manifest
- precision, recall and false-alert rate by capability
- tested camera/source type
- hardware profile
- known failure modes
- rollback target

## Model Card Template

```yaml
model_id: ""
capability: "PERSON_VEHICLE | ANPR | FACE_DETECTION | NIGHT_MOVEMENT"
artifact: ""
sha256: ""
runtime: "CPU | CUDA | TENSORRT"
trained_on: ""
validated_on: ""
metrics:
  precision: "not_measured"
  recall: "not_measured"
  false_alert_rate: "not_measured"
  fps: "not_measured"
hardware:
  device: ""
  camera_count: 0
approval:
  status: "NOT_PROMOTED"
  approved_by: ""
  approved_at: ""
rollback_to: ""
notes: ""
```

Large model artifacts stay outside git. Commit only manifests, checksums and model cards.
