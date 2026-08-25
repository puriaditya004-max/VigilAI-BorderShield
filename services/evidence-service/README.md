# evidence-service

Clips, keyframes, hashes, retention.
Immutable evidence manifest (SHA-256), MinIO S3-compatible storage, lifecycle policy.

Current foundation:

- `verifyEvidenceManifest()` validates the `EvidenceManifest` contract
- local `file://` assets are hash-checked before evidence is accepted
- manifest digest helper prepares the later immutable object-store record

This keeps real clips/keyframes auditable before MinIO is introduced.
