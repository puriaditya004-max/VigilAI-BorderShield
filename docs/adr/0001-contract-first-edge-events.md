# ADR 0001: Contract-first edge events

## Status

Accepted.

## Context

BorderShield has edge services, command services, evidence storage and operator UI. If these modules exchange informal payloads, the project will become hard to test and unsafe to evolve.

## Decision

All service boundaries start with versioned event contracts in `packages/contracts/`. Edge analytics must emit `TrackEvent` and `IncidentEvent`; command services must reject invalid event shapes.

## Consequences

- integrations can be tested before final model/runtime choices
- real YOLO/ByteTrack can replace simulation without changing API contracts
- breaking changes require new schema versions instead of silent payload drift
