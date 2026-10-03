# AGENTS.md - LeafCheck AI Project Rules

## 1. Project Overview

LeafCheck AI is a smart indoor plant health monitoring platform. It combines IoT environmental sensing (ESP32) with multi-provider AI computer vision (Gemini 2.0 Flash, Pl@ntNet, Perenual) and mobile Augmented Reality (Three.js) to help users care for indoor plants proactively. The project is structured as an npm workspace monorepo.

## 2. Repository Structure

- `frontend/`: Expo & React Native mobile application
- `backend/`: Express.js REST API with dual-database Prisma ORM
- `hardware/firmware/`: ESP32 C++ firmware (PlatformIO / Arduino)
- `docs/`: Architecture specifications and technical audits

## 3. Tech Stack

- **Frontend**: React Native (0.86.3), React (19.2.3), Expo SDK (^57.0.22), Expo Router, Three.js, expo-camera, expo-secure-store, AsyncStorage, Reanimated.
- **Backend**: Node.js (ES Modules), TypeScript, Express.js (^4.21.2), tsx, Argon2id (hash-wasm), jose (JWT), helmet, cors, express-rate-limit.
- **Database**: Prisma ORM 6. Dual-database architecture:
  - PostgreSQL: Relational application state, security, domain models (User, Plant, CareTask, etc.)
  - MongoDB: High-volume time-series environmental readings (SensorReading)
- **Hardware**: ESP32, PlatformIO, Arduino, Sensirion SHT31 (Temp/Humidity), BH1750 (Lux), Capacitive Soil Moisture Sensor.
- **AI Pipeline**: Pl@ntNet (species ID), Perenual (care specs), Google Gemini 2.0 Flash (multimodal diagnostics).

## 4. Agent Skills & Database Rules

- You have access to specialized skills in the `.agents/skills/` directory.
- **CRITICAL**: When working on database tasks, you MUST look into the relevant `prisma-*` skill folder (e.g., `prisma-postgres`, `prisma-client-api`, `prisma-cli`) to ensure you are using the correct patterns for this project's dual-database setup.
- Always use the Prisma Client for database queries. Never write raw SQL unless explicitly instructed.

## 5. Coding Standards & Constraints

- **Strict TypeScript**: Never use `any`. Use `unknown` and type guards if necessary.
- **React**: Use functional components with hooks. Do not use class components. Use Expo Router for navigation.
- **Authentication**: Keep short-lived access JWTs strictly in memory. Store refresh tokens in hardware Keystore/Keychain via `expo-secure-store` (native) or Secure HttpOnly SameSite cookies (web).
- **Environment Variables**: Never hardcode API URLs or secrets. Always use `process.env.EXPO_PUBLIC_API_URL` in frontend or standard `.env` files in backend.
- **Testing**: Use Node.js native test runner (`node --test`) for backend. Run `npm test` after making changes to core logic or backend routes.
- **Hardware**: Maintain ArduinoJson serialization standards for ESP32 telemetry POST requests to `/api/telemetry`.

## 6. Workflow Rules

- **Before Coding**: Always read the relevant files (e.g., `schema.postgres.prisma`, `schema.prisma`, `ARCHITECTURE.md`) first. If the task is complex, enter Plan Mode (Shift+Tab) and outline your approach before writing code.
- **Commits**: Do not commit to git unless explicitly asked. If asked, use conventional commits (e.g., `feat:`, `fix:`).
- **Done Criteria**: A task is only complete when: 1) The code compiles without TypeScript errors. 2) The specific feature works as described. 3) Existing tests still pass.
