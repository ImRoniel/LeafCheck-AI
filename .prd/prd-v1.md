---
version: 1
status: built
date: 2026-09-30
---

# LeafCheck AI — Product Requirements Document

## 1. Problem

Indoor plant owners often discover health problems too late because they do not have a simple way to connect plant, environmental conditions, and expert guidance in one place. A plant can appear healthy on the surface while environmental stressors, light imbalance, or moisture drift are already affecting it. The product must reduce this blind spot by giving users a trusted, low-friction way to capture plant health signals, understand the cause, and receive actionable care advice.

This PRD captures the core product need behind the existing repository shape: a mobile-first indoor plant monitoring and AI-assisted care workflow spanning app onboarding, telemetry ingestion, analysis, and guided recommendations. The original brief used for this draft is: "Your high-level idea here".

## 2. Solution

We will build a plant health monitoring experience that combines account-scoped plant management, device telemetry collection, and multi-provider AI diagnosis to surface clear plant health summaries alongside concrete care suggestions. The system uses backend-owned validation and ownership checks to keep user data isolated, stores time-series readings separately from relational state, and presents the result in a mobile application that remains easy to use during daily plant care.

The solution assumes an authenticated app experience, one or more plant-associated devices or synthetic telemetry inputs, and a backend service that can orchestrate identification, environmental context, and AI reasoning without exposing raw secrets to the client. It explicitly excludes broad marketplace expansion, external community features, and premium hardware device manufacturing.

## 3. Scope

| This PRD covers                                             | This PRD does NOT cover                      |
| ----------------------------------------------------------- | -------------------------------------------- |
| User onboarding and plant ownership model                   | Public plant marketplace or social features  |
| Device-associated or synthetic telemetry ingestion          | Hardware manufacturing or custom PCB design  |
| AI species identification and health diagnosis workflow     | Full autonomous care execution or robotics   |
| Care recommendations and dashboard summaries                | Enterprise multi-tenant admin workflows      |
| Backend validation and trust boundaries for external inputs | Large-scale distributed deployment at launch |

## 4. Requirements

### R-01 — User and plant onboarding

- **S-01:** Given a new user with valid registration details, when they sign up and create a plant profile, then the account is created and the plant is linked to the authenticated user.
- **S-02:** Failure path: when the supplied fields are invalid, duplicate, or empty, the system rejects the request with a validation or conflict error and does not create duplicate records.
- **S-03:** Preserve: existing authenticated ownership semantics must remain enforced so a user can only access their own plants and sessions.

### R-02 — Telemetry ingestion and data integrity

- **S-01:** Given a registered device or an authenticated synthetic seed flow, when telemetry is posted to the backend, then the system validates numeric values and stores the reading with the correct plant/device association.
- **S-02:** Failure path: when a payload is malformed, contains non-finite values, references an unknown device, or exceeds supported limits, the backend rejects it and logs the server-side failure without reflecting raw details to the client.
- **S-03:** Preserve: existing behavior must continue to distinguish relational plant ownership from time-series telemetry storage so plant and reading access remain account-scoped.

### R-03 — AI plant identification and diagnosis flow

- **S-01:** Given a user-uploaded plant image and an owned plant context, when the scan flow runs, then the backend resolves species context and runs the diagnosis pipeline to produce a human-readable health assessment.
- **S-02:** Failure path: when the image is too large, missing, or outside supported validation rules, the workflow aborts cleanly and returns a safe error without exposing provider internals.
- **S-03:** Preserve: existing provider orchestration behavior must remain in place, including ownership checks before provider calls and the separation of raw analysis text from derived health metadata.

### R-04 — Care guidance and dashboard summaries

- **S-01:** Given a completed diagnosis, when the user opens the plant dashboard, then the system presents the latest health status, environmental context, and recommended care actions in a concise mobile-friendly format.
- **S-02:** Failure path: when telemetry is stale or unavailable, the dashboard shows a clear degraded state instead of inventing confident recommendations.
- **S-03:** Preserve: historical plant and alert information must remain available while the latest summary remains mounted to the authenticated user’s plant state.

### R-05 — Security and platform trust boundaries

- **S-01:** Given all external inputs, when requests reach the application, then the server validates them before using them in database operations or provider calls.
- **S-02:** Failure path: when the client submits untrusted values or a forged device association, the system blocks the request and returns a generic failure message while retaining detailed diagnostics only in server logs.
- **S-03:** Preserve: credentials and refresh tokens remain server-controlled; no raw secret or API token is exposed to the mobile client.

## 5. Architecture

### Structure

```text
backend/
  prisma/
    schema.postgres.prisma
    schema.prisma
    migrations/
  src/
    lib/
    routes/
    server.ts
frontend/
  app/
  components/
  services/
  context/
  hooks/
hardware/
  firmware/
    src/
```

### Key components

- Backend API gateway: Express-based entrypoint that enforces rate limits, validation, JSON-size constraints, and authenticated route boundaries.
- Relational layer: PostgreSQL stores users, sessions, refresh tokens, plants, devices, species cache, and AI analysis records.
- Time-series layer: MongoDB persists sensor readings and supports time-window queries for recent and historical telemetry.
- AI orchestrator: The backend calls plant identification and environmental diagnosis services, then stores the context and results without exposing provider secrets to mobile clients.
- Mobile app client: Expo/React Native app presents onboarding, plant detail, telemetry charts, and AI-driven recommendations using account-scoped state.
- Hardware integration: ESP32 firmware sends sensor data to the API using the configured device registration flow.

### Data flow

User input → authenticated API validation → ownership checks and persistence → telemetry + context records → AI orchestration → diagnostic result → plant dashboard / recommendation display.

## 6. Success Criteria

| Criterion                                                        | How to verify                                                                                   |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Users can register, authenticate, and manage plant records       | Run backend auth and plant route tests; verify successful registration and secure access checks |
| Telemetry enters the system with validation and ownership checks | Run telemetry route tests and confirm invalid payloads are rejected                             |
| AI scan flow produces a plant health summary                     | Execute the scan flow test suite and inspect the returned structured analysis metadata          |
| Dashboard renders a clear care view                              | Confirm the frontend UI loads a plant record with health and environmental data                 |
| Secrets remain server-side only                                  | Review configuration and environment handling to confirm no secrets are embedded in client code |

## 7. Out of Scope

- Full marketplace, community, or social features
- Manufacturing or direct hardware commercialization
- Autonomous plant care hardware actions beyond monitoring and recommendations
- Multi-region deployment and global failover at launch
- Unbounded analytics or cross-user benchmarking features

## 8. Visual Direction

The product should feel calm, trustworthy, and guided rather than intense or overly technical. The tone is clean, supportive, and grounded. The UI should use a light mode with a soft botanical palette, high contrast for legibility, and a green-to-olive dominant theme with subtle accent colors for warnings or action states. Typography should pair a modern sans-serif for UI labels with a slightly more expressive display face for headings. The design should avoid heavy dark-mode clutter, neon indicator styling, or cluttered dashboard density that overwhelms a user checking a plant quickly.

## 9. Security & Trust Boundaries

The project accepts untrusted inputs from user registration, captured images, plant metadata, device telemetry, and third-party provider responses. These inputs are validated at the backend before they are used in database writes or prompt generation. Secrets such as API keys and provider credentials live only server-side in environment variables named in `.env.example` and are never placed in the frontend bundle. On failure, the client sees generic, sanitized messages while the server retains detailed operational logs for debugging.

## 10. Dependencies & Risks

This work depends on the existing repository architecture and on provider integrations for species lookup and AI diagnosis. Risks include partial database state across PostgreSQL and MongoDB, provider availability or quota constraints, and telemetry ingestion without device-level authentication. These risks are acceptable within this PRD if handled through backend validation, clear degraded states, and explicit operational logging, but they remain material delivery risks that should be tracked in implementation and evaluation.
