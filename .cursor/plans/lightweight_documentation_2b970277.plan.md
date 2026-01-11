---
name: Lightweight Documentation
overview: Add minimal, maintainable documentation focused on JSDoc comments for public APIs and an expanded README, deferring formal docs until the API stabilizes.
todos:
  - id: expand-readme
    content: Expand README with overview, features, and quick start code snippet
    status: pending
  - id: jsdoc-highlevel
    content: Add JSDoc to createNetcodeServer and createNetcodeClient
    status: pending
  - id: jsdoc-types
    content: Add JSDoc to core types (SimulateFunction, InterpolateFunction, etc)
    status: pending
  - id: jsdoc-prediction
    content: Add JSDoc to PredictionScope interface and related client APIs
    status: pending
---

# Lightweight Documentation

## Overview

Keep documentation close to the code and focused on concepts rather than implementation details. This minimizes maintenance burden while the API is still evolving.

## What To Do

### 1. Expand README

Update [`README.md`](README.md) from 16 lines to ~50-80 lines:

- **What it is**: 1-2 paragraphs explaining server-authoritative netcode with client-side prediction
- **Features list**: Bullet points (prediction, reconciliation, interpolation, rollback)
- **Quick start**: Minimal server + client code snippet
- **Link to example**: Point to `packages/app` as reference implementation
- **Link to concepts**: Point to `/docs` folder for theory

### 2. JSDoc Public APIs

Add JSDoc comments to exported functions/classes in [`packages/netcode/src/index.ts`](packages/netcode/src/index.ts) and the files they reference:

Priority targets (most likely to be used by consumers):

- `createNetcodeServer()` in [`create-server.ts`](packages/netcode/src/create-server.ts)
- `createNetcodeClient()` in [`create-client.ts`](packages/netcode/src/create-client.ts)
- `SimulateFunction`, `InterpolateFunction` types in [`core/types.ts`](packages/netcode/src/core/types.ts)
- `PredictionScope` interface in [`client/prediction-scope.ts`](packages/netcode/src/client/prediction-scope.ts)

JSDoc should include:

- Brief description
- `@param` for each parameter
- `@returns` description
- `@example` where helpful

### 3. Keep Concept Docs

The Gabriel Gambetta articles in [`/docs`](docs/) explain the theory. These don't need updates - they're reference material.

## What To Skip (For Now)

- API reference site (generated docs)
- Tutorials or guides
- Changelog (use git history)
- Contributing guide (solo project)

## When To Revisit

After implementing 2-3 major features (e.g., Lag Compensation + Real Game Features), reassess whether formal docs are needed.