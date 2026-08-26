# datasets

Dataset manifests and DVC pointers only — no secrets, no raw biometric media.
Mandatory slices: day/dusk/night/IR/fog/rain/dust/glare/compression/occlusion.

## Validation Manifest Template

```yaml
dataset_id: ""
source_owner: ""
legal_basis: ""
storage_uri: ""
sha256_manifest: ""
contains_biometric_media: false
slices:
  day: 0
  dusk: 0
  night: 0
  ir: 0
  fog: 0
  rain: 0
  dust: 0
  glare: 0
  compression: 0
  occlusion: 0
labels:
  person: 0
  vehicle: 0
  plate: 0
  face: 0
privacy:
  raw_media_committed_to_git: false
  face_identity_labels: false
  retention_days: 0
```

Accuracy and false-alert reporting must reference a validation manifest. Fixture tests prove software flow, not model quality.
