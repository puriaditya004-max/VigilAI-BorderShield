# evidence-service

Clips, keyframes, hashes, retention.
Immutable evidence manifest (SHA-256), MinIO S3-compatible storage, lifecycle policy.

Current foundation:

- `verifyEvidenceManifest()` validates the `EvidenceManifest` contract
- local `file://` assets are hash-checked before evidence is accepted
- manifest digest helper prepares the later immutable object-store record
- optional AES-256-GCM evidence encryption is enabled with `EVIDENCE_ENCRYPTION_KEY`
- `expireEvidenceManifests()` marks old manifests expired and can delete local file assets
- `npm run evidence:retention` runs retention cleanup from the command line

This keeps real clips/keyframes auditable before MinIO is introduced.

Operational settings:

- `EVIDENCE_ENCRYPTION_KEY`: passphrase, 64-character hex key, or `base64:<32-byte-key>`
- `EVIDENCE_RETENTION_DAYS`: default `30`
- `EVIDENCE_RETENTION_DELETE_FILES`: default `true`

When encryption is enabled, generated keyframe evidence is written as `.enc` and the manifest SHA-256 covers the encrypted artifact.
