# LeafCheck AI

Indoor plant health monitoring with ESP32 sensing, AI image analysis, and mobile and browser applications.

## Overview

LeafCheck AI combines environmental measurements with image-based plant identification and health assessment. Users can manage plants, capture plant photographs, review diagnostic reports, track care tasks, connect sensors, and inspect telemetry history. A separate administrator portal provides role-controlled user management, device operations, hardware provisioning, platform settings, integration status, and audit views.

The project is an **npm-workspace monorepo** combining **MERN/PERN technologies**: MongoDB and PostgreSQL, Express, React, and Node.js. The mobile application uses React Native and Expo; the administrator application uses React and Vite. ESP32 firmware is maintained alongside the application workspaces as a separate PlatformIO project.

The implementation includes:

- Gemini image analysis with optional Pl@ntNet identification hints and Perenual reference enrichment.
- Plant records, diagnostic archives, AI-derived manual care tasks, and explicitly labeled demo telemetry.
- Device approval, claiming, pairing history, and plant-scoped environmental readings.
- Supabase authentication, staff email OTP verification, server-side permissions, and audit records.

## Contents

- [Architecture](#architecture)
- [Repository structure](#repository-structure)
- [Tech stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation and local setup](#installation-and-local-setup)
- [Hardware setup](#hardware-setup)
- [Testing and quality checks](#testing-and-quality-checks)
- [Deployment](#deployment)
- [Further documentation](#further-documentation)

## Architecture

```mermaid
flowchart LR
    Mobile[Expo / React Native app] --> API[Express / TypeScript API]
    Admin[React / Vite admin portal] --> Proxy[Same-origin /api proxy]
    Proxy --> API
    ESP32[ESP32 sensors] -->|POST /api/telemetry| API
    API -->|Prisma| PG[Supabase PostgreSQL]
    API -->|Prisma| Mongo[MongoDB sensor readings]
    API --> Auth[Supabase Auth when enabled]
    API --> Gemini[Gemini]
    API --> References[Optional Pl@ntNet and Perenual]
    API --> Photos[Optional Cloudinary photo storage]
```

### Backend and database responsibilities

The Express backend serves both client applications. It handles authentication, authorization, plants, devices, telemetry, AI scans, care tasks, and administrative operations. Database and provider credentials remain on the backend.

Prisma uses separate clients for each responsibility:

| Schema | Database | Responsibility |
| --- | --- | --- |
| `backend/prisma/schema.postgres.prisma` | PostgreSQL | Users, plants, devices, pairing history, analyses, care tasks, sessions, provisioning, settings, and audits |
| `backend/prisma/schema.prisma` | MongoDB | Timestamped `SensorReading` documents in `sensorReadings` |
| `backend/prisma/schema.auth-read.prisma` | Supabase PostgreSQL | Read projection of Supabase-owned `auth.users` and `auth.sessions` |

Application domain tables use PostgreSQL's `public` schema; administrator challenges, verification records, and audits use `admin_security`. Supabase owns the `auth` schema. PostgreSQL and MongoDB have independent transactions; the backend coordinates their references and pairing context.

### Client applications and data flow

- **Mobile (`frontend/`):** Expo and React Native with Expo Router. Screens cover authentication, plants, scanning, archives, care tasks, device connection, and telemetry. The application also has an Expo web entry.
- **Admin web (`admin-web/`):** A standalone React/Vite application with React Router. It accesses Express through a same-origin `/api` proxy in local development and through Vercel rewrites in production.
- **Hardware (`hardware/firmware/`):** ESP32 firmware posts readings to Express. The backend validates hardware approval and resolves PostgreSQL pairing context before inserting a MongoDB reading. Clients retrieve readings through authenticated API endpoints.

The primary scan route, `POST /api/scan`, attempts optional Pl@ntNet identification, uses Gemini to confirm the image subject and species, retrieves available references and telemetry, and requests a contextual diagnosis. Relational scan results are saved through Prisma in PostgreSQL. The default Gemini model is `gemini-2.5-flash`, configurable through `GEMINI_MODEL`.

Physical sensors measure temperature, humidity, raw soil ADC, and ambient light in lux. Physical soil-moisture percentage remains unavailable without a supported calibration mapping. Soil pH is reference data; AR views are currently unavailable.

### Authentication and security boundaries

Application access uses Zero Trust principles through current-session checks, ownership validation, and server-enforced permissions. Supabase staff password login requires an eight-digit email OTP before the backend establishes the verified staff session. Permissions distinguish `ADMIN`, `LEAD_DEV`, and `USER` accounts.

Access tokens remain in client memory. Native refresh credentials use Expo SecureStore; browser refresh credentials use a Secure, HttpOnly, SameSite=Strict cookie. Browser authentication mutations require an allowed Origin and CSRF header. Helmet, CORS restrictions, and request rate limits protect the API.

Hardware ingestion checks approved and claimed identifiers. The current ESP32 firmware does not send cryptographic device credentials, so identifier approval does not authenticate the physical sender. See [administrator security](backend/ADMIN_SECURITY.md) for the implemented trust boundaries.

## Repository structure

```text
LeafCheck-AI/
├── backend/
│   ├── src/
│   │   ├── server.ts           # Express entry point
│   │   ├── routes/             # REST endpoints
│   │   ├── lib/                # Auth, providers, persistence, domain services
│   │   └── generated/          # Generated custom Prisma clients
│   ├── prisma/                 # Schemas and PostgreSQL migrations
│   ├── scripts/                # Integration runners and operational utilities
│   ├── supabase/               # Authentication email templates
│   └── tests/
├── frontend/
│   ├── app/                    # Expo Router screens
│   ├── components/
│   ├── context/
│   ├── hooks/
│   ├── services/
│   └── tests/
├── admin-web/
│   ├── src/                    # React administrator portal
│   ├── tests/                  # Node and Playwright browser tests
│   ├── vite.config.ts          # Local development API proxy
│   └── vercel.json             # Production API and SPA rewrites
├── hardware/
│   └── firmware/
│       ├── platformio.ini
│       └── src/
│           ├── main.cpp
│           └── config.template.h
├── docs/                       # Project documentation and review material
├── package.json                # Root workspace commands
└── package-lock.json           # Shared dependency lockfile
```

The npm workspaces are `frontend`, `backend`, and `admin-web`. Firmware dependencies are managed by PlatformIO.

## Tech stack

| Area | Core technologies |
| --- | --- |
| Runtime and language | Node.js, TypeScript, ES modules |
| Backend | Express 4, Prisma 6, `tsx`, dotenv |
| Databases | Supabase PostgreSQL, MongoDB |
| Authentication | Supabase Auth, `jose`, Argon2id through `hash-wasm` |
| API protection | Helmet, CORS, `express-rate-limit` |
| Mobile | Expo SDK 57, React Native 0.86.3, React 19.2.3, Expo Router |
| Mobile capabilities | Expo Camera, Image Picker, SecureStore, AsyncStorage, Reanimated |
| Admin web | React 19, Vite 8, React Router, Tailwind CSS 4, Lucide |
| AI and references | Google Generative AI SDK, Gemini, optional Pl@ntNet and Perenual |
| Images and task extraction | Cloudinary, Sharp, `tasknotes-nlp-core` |
| Firmware | ESP32, PlatformIO, Arduino framework, ArduinoJson 7 |
| Sensors | SHT31, BH1750, capacitive soil-moisture sensor |
| Verification | Node.js native test runner, `tsx`, Playwright, Docker integration runners |
| Hosting configuration | Render backend, Vercel administrator portal |

Dependency manifests and `package-lock.json` define the installed versions.

## Prerequisites

Install or obtain:

- **Git**.
- **Node.js 24.x and npm**, matching the runtime documented in the backend setup guide.
- **Expo Go compatible with Expo SDK 57**, or a compatible development build, plus a physical device or emulator. An Android emulator requires Android tooling; an iOS simulator requires macOS and Xcode. Project scripts use the locally installed Expo CLI.
- A development **Supabase project** with PostgreSQL and Auth configured for the application.
- A **MongoDB replica set**, such as MongoDB Atlas. Transaction-based operations, including demo telemetry, require replica-set support.
- A valid **Gemini Developer API key** with access to the selected model.
- Optional Pl@ntNet, Perenual, and Cloudinary accounts for their integrations.
- Optional **Docker** for database integration suites and **Playwright Chromium** for administrator browser tests.
- Optional **PlatformIO Core** or the VS Code PlatformIO extension, an ESP32, and the supported sensors for firmware development.

The development PostgreSQL database must match the current application schema and migration-defined constraints. See [database and authentication readiness](#5-check-database-and-authentication-readiness).

## Installation and local setup

Run commands from the repository root unless another directory is specified. Examples use a POSIX-compatible shell; on Windows, copy files using the equivalent PowerShell commands or your editor.

### 1. Clone the repository

```bash
git clone https://github.com/ImRoniel/LeafCheck-AI.git
cd LeafCheck-AI
```

### 2. Configure environment files

Copy the client templates:

```bash
cp frontend/.env.example frontend/.env
cp admin-web/.env.example admin-web/.env
```

Create `backend/.env` manually; there is no backend `.env.example`. Edit the copied client files to match the configuration below. Replace all credential and host placeholders. API URLs must contain no embedded spaces.

Environment files are ignored by Git. Database credentials, provider keys, and JWT secrets belong in the backend environment. `EXPO_PUBLIC_*` and `VITE_*` values are exposed to clients.

#### Backend: `backend/.env`

The following configuration supports the local mobile app and administrator portal using Supabase authentication:

```dotenv
# Local runtime. The admin HTTP origin below requires development mode.
NODE_ENV=development
PORT=3000

# MongoDB telemetry connection, including a database name.
DATABASE_URL=mongodb+srv://your_user:your_password@your_cluster.mongodb.net/leafcheck

# PostgreSQL application and direct migration connections.
POSTGRES_URL=postgresql://your_user:your_password@your_postgres_host:5432/postgres?sslmode=require
DIRECT_URL=postgresql://your_user:your_password@your_direct_postgres_host:5432/postgres?sslmode=require

# Required when AUTH_PROVIDER=supabase.
AUTH_PROVIDER=supabase
SUPABASE_URL=https://your_project_ref.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_key_here
SUPABASE_SECRET_KEY=your_key_here

# Required application JWT settings, including in Supabase mode.
AUTH_JWT_SECRET=your_generated_base64url_secret_here
AUTH_JWT_ISSUER=leafcheck-ai
AUTH_JWT_AUDIENCE=leafcheck-ai-clients

# Exact browser origins; comma-separated, without trailing slashes.
AUTH_ALLOWED_ORIGINS=http://localhost:5174

# Required Gemini Developer API key.
GEMINI_API_KEY=your_key_here
```

Generate the value for `AUTH_JWT_SECRET` locally:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Paste the generated value into your local environment file. The backend requires a sufficiently random base64url secret representing at least 32 random bytes. Keep this application secret independent of Supabase credentials.

Configuration rules:

- **`DATABASE_URL` is the MongoDB connection**, despite the generic name. The Prisma telemetry schema does not use `MONGODB_URI`.
- `POSTGRES_URL` and `DIRECT_URL` must reference the intended PostgreSQL database. Supply the runtime and direct connection strings appropriate to your Supabase project.
- `SUPABASE_URL` must be an HTTPS project origin. Supabase credentials remain backend-only in this implementation.
- `GEMINI_API_KEY` must be a Gemini Developer API key, rather than an OAuth bearer token or service-account JSON.
- `AUTH_ALLOWED_ORIGINS` accepts exact origins. `http://localhost:5174` is the supported local HTTP exception in development; other browser origins require HTTPS.
- `AUTH_PROVIDER` also supports `legacy` and defaults to it when omitted. Use `supabase` for the administrator OTP flow and email-code features. Switching the provider does not import or link existing accounts automatically.
- Hosting/process environment values take precedence over `backend/.env`.

Optional backend configuration:

| Variable | Purpose and default |
| --- | --- |
| `GEMINI_MODEL` | Gemini model override; default `gemini-2.5-flash` |
| `PLANTNET_API_KEY` | Optional species-identification hints |
| `PERENUAL_API_KEY` | Optional reference care specifications |
| `CLOUDINARY_CLOUD_NAME` | Cloud name for hosted plant photographs |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |
| `MONGO_TELEMETRY_RETENTION_DAYS` | Optional startup TTL-index setup; default `0` |
| `AUTH_HASH_WORKERS` | Password worker count, 1–8; defaults to the smaller of 2 and available CPU parallelism |
| `AUTH_HASH_QUEUE_LIMIT` | Password queue limit, 0–256; default 32 |
| `AUTH_ALLOW_LOCAL_ADMIN_ORIGIN` | Explicit production opt-in for the exact local admin origin; still requires that origin in the allowlist |

Example optional provider values:

```dotenv
PLANTNET_API_KEY=your_key_here
PERENUAL_API_KEY=your_key_here
CLOUDINARY_CLOUD_NAME=your_cloud_name_here
CLOUDINARY_API_KEY=your_key_here
CLOUDINARY_API_SECRET=your_key_here
```

All three Cloudinary values are required to enable hosted uploads. Without configuration, scan photos use the implementation's inline JPEG fallback. Missing Pl@ntNet or Perenual keys do not prevent Gemini-only scanning.

#### Mobile: `frontend/.env`

```dotenv
EXPO_PUBLIC_API_URL=http://localhost:3000
```

Choose the backend origin reachable from the device running the application:

| Target | API base URL |
| --- | --- |
| iOS simulator | `http://localhost:3000` |
| Android emulator | `http://10.0.2.2:3000` |
| Physical phone | `http://your_computer_lan_ip:3000` |
| Hosted backend | `https://your_backend_host` |

Use the backend origin **without `/api`**; the mobile client supplies endpoint paths. For a physical phone, replace the LAN placeholder with the computer's reachable address and permit access to port 3000. Expo's Metro tunnel does not expose the backend API.

#### Administrator portal: `admin-web/.env`

```dotenv
VITE_API_URL=/api
API_PROXY_TARGET=http://127.0.0.1:3000
```

`VITE_API_URL` is public browser configuration. `API_PROXY_TARGET` is consumed only by the Vite development server, which forwards `/api/*` while preserving the API path.

The checked-in Vite fallback and admin template target backend port **4000**. The explicit override above aligns the portal with Express's default port **3000**. Vite serves the administrator portal on **5174** and requires that port to be available.

Restart the affected development server after changing its environment file. Fully reload the Expo application after changing its API URL.

### 3. Install workspace dependencies

Install the locked dependencies for the root and all three npm workspaces:

```bash
npm ci
```

Separate npm installs inside each application directory are unnecessary. PlatformIO manages firmware dependencies independently.

### 4. Generate Prisma clients

```bash
npm run db:generate:all --workspace=backend
```

This generates the MongoDB client and the custom application PostgreSQL and Supabase auth-read clients. Generation does not apply schema changes or seed data. Backend `dev`, `dev:watch`, and `build` also generate these clients automatically.

### 5. Check database and authentication readiness

#### PostgreSQL

The current migration history does not completely reconstruct the latest application schema from an empty database: it omits `CareTask` and newer `AIAnalysis` fields. Use a development database reconciled to `schema.postgres.prisma` and the native constraints in the migration files. The integration runners generate test-only baselines for disposable fixtures; they are not application database bootstrap commands.

For a database whose baseline and migration history have been reviewed, pending PostgreSQL migrations are applied from `backend/`:

```bash
cd backend
npx prisma migrate deploy --schema=prisma/schema.postgres.prisma
cd ..
```

Follow [the authentication deployment guide](backend/AUTH_DEPLOYMENT.md) for databases created before migration tracking. PostgreSQL `db push` does not recreate all native pairing constraints. Client generation and application builds do not apply migrations.

#### MongoDB

Synchronize telemetry indexes against your development MongoDB instance:

```bash
npm run db:push --workspace=backend
```

This script targets the MongoDB `schema.prisma`. PostgreSQL migrations do not synchronize MongoDB indexes.

#### Supabase Auth

For `AUTH_PROVIDER=supabase`:

1. Enable email authentication and email confirmation.
2. Configure email delivery in Supabase.
3. Set email OTP length to **eight digits**.
4. Configure confirmation, magic-link, and recovery templates to display `{{ .Token }}`. Template sources are under `backend/supabase/templates/`.
5. Configure access JWT expiration to **900 seconds**.
6. Use the same project's PostgreSQL database for application state and provider-session reads. The backend database role needs read access to `auth.users` and `auth.sessions`.

`schema.auth-read.prisma` projects Supabase-owned tables. **Never run migrations or `db push` against this schema.**

Administrator sign-in requires an active application account with a staff role linked to a confirmed Supabase identity. Public registration creates `USER` accounts and does not grant administrator privileges.

See [Supabase authentication setup](backend/AUTH_MIGRATION.md) and [administrator security](backend/ADMIN_SECURITY.md) for complete contracts and migration requirements.

### 6. Start the applications

Use separate terminals, each opened at the repository root.

**Backend:**

```bash
npm run backend
```

The API listens on `http://localhost:3000` with the configuration above. To restart automatically after source changes:

```bash
npm run dev:watch --workspace=backend
```

Check API liveness:

```bash
curl http://localhost:3000/health
```

`/health` reports liveness. Authenticated `/api/admin/health` checks the two databases independently.

**Mobile application:**

```bash
npm run frontend
```

Follow the Expo CLI instructions to open a compatible Expo Go client, development build, or emulator. Platform shortcuts are also available:

```bash
npm run android --workspace=frontend
npm run ios --workspace=frontend
```

The Expo browser entry can be started with:

```bash
npm run web --workspace=frontend
```

Authenticated Expo web use requires a suitable HTTPS browser/API setup and an exact allowed frontend origin. The backend's local HTTP exception applies specifically to the admin origin on port 5174.

**Administrator portal:**

```bash
npm run admin-web
```

Open `http://localhost:5174`.

The root convenience command starts the backend and mobile development server together:

```bash
npm run dev
```

Start the administrator workspace separately.

## Hardware setup

Firmware setup is optional for application development. The mobile app includes an explicitly labeled demo-telemetry workflow for owned plants without physical sensor readings.

| Sensor | Measurement | Default connection |
| --- | --- | --- |
| SHT31 | Temperature and relative humidity | I2C address `0x44` |
| BH1750 | Ambient light in lux | I2C address `0x23` |
| Capacitive soil sensor | Raw 12-bit ADC value | GPIO 34 |

Default I2C pins are SDA 21 and SCL 22. Copy the tracked configuration template:

```bash
cp hardware/firmware/src/config.template.h hardware/firmware/src/config.h
```

In the ignored local header, configure `WIFI_SSID`, `WIFI_PASSWORD`, `SERVER_URL` including `/api/telemetry`, `DEVICE_ID`, pin assignments, and sensor calibration. Approve the hardware identifier through provisioning, claim it in the application, and pair it with the intended plant.

Open `hardware/firmware/` as a PlatformIO project, build the `esp32dev` environment, and upload to the intended connected board. The serial monitor uses **115200 baud**; the configured delay between telemetry cycles is **15 seconds**.

The firmware sends `deviceId`, `temperature`, `humidity`, `soilMoisture`, `soilMoistureRaw`, and `lightLux`. Both soil fields carry raw ADC values; the backend assigns timestamps. See [the firmware guide](hardware/firmware/README.md) for calibration, wiring, and manual checks.

## Testing and quality checks

All three application workspaces use Node.js's native test runner. TypeScript suites use `tsx`; the administrator browser suite uses Playwright.

### Application suites

After installing dependencies and generating backend clients:

```bash
npm test --workspaces --if-present
```

Run a workspace individually:

```bash
npm test --workspace=backend
npm test --workspace=frontend
npm test --workspace=admin-web
```

The root package has no standalone `test` script; select workspaces explicitly. These application suites use mocked dependencies where needed and do not establish live provider or hardware readiness.

### Administrator browser suite

Install Chromium for Playwright, then run the browser tests:

```bash
npm exec --workspace=admin-web -- playwright install chromium
npm run test:browser --workspace=admin-web
```

The suite starts its own Vite server and intercepts API requests with fixtures.

### Database integration suites

Install and start Docker, then pull the images expected by the runners:

```bash
docker pull postgres:16-alpine
docker pull mongo:7.0
```

Run the suites sequentially:

```bash
npm run test:admin-security --workspace=backend
npm run test:plant-pairing --workspace=backend
npm run test:plant-telemetry --workspace=backend
npm run test:scan-persistence --workspace=backend
npm run test:telemetry-schema --workspace=backend
```

The runners create disposable databases, supply isolated database connections, and clean up their owned containers. External authentication is simulated where applicable. Hosted email delivery, provider authorization, and physical sensor behavior require separate integration verification.

### Build, type, and lint checks

```bash
npm run build --workspace=backend
npm run typecheck --workspace=frontend
npm run typecheck --workspace=admin-web
npm run build --workspace=admin-web
npm run lint --workspace=frontend
npm run lint --workspace=admin-web
```

The backend build generates clients, compiles TypeScript, and packages custom Prisma clients into `backend/dist/`. The administrator build performs TypeScript checking and writes its static output to `admin-web/dist/`.

## Deployment

### Express backend on Render

The checked-in administrator rewrite points to `https://leafcheck-ai.onrender.com`. The backend package provides build and start commands; Render service configuration is managed separately.

For a service using the repository root:

| Setting | Value |
| --- | --- |
| Runtime | Node.js 24.x |
| Root directory | Repository root |
| Build command | `npm ci && npm run build --workspace=backend` |
| Start command | `npm run start --workspace=backend` |
| Health-check path | `/health` |

Configure backend credentials through Render's environment settings. Use `NODE_ENV=production`, configure `AUTH_PROVIDER=supabase` for administrator authentication, and set `AUTH_ALLOWED_ORIGINS` to the exact HTTPS administrator origin. Preserve any other required approved browser origins.

Allow the hosting environment to supply `PORT`; Express binds to `0.0.0.0`. Deploy the complete build output and required dependencies, including packaged Prisma clients. Database preparation and reviewed migrations are separate steps; the build and start commands do not apply PostgreSQL migrations.

### Administrator portal on Vercel

Configure the Vercel project with:

| Setting | Value |
| --- | --- |
| Root directory | `admin-web` |
| Framework preset | Vite |
| Build command | `npm run build` |
| Output directory | `dist` |
| Public environment variable | `VITE_API_URL=/api` |

`admin-web/vercel.json` defines the production rewrites in this order:

1. `/api/:path*` forwards to the Render backend's `/api/:path*`.
2. Other application routes resolve to `/index.html` for React Router.

Verify the backend destination for the intended deployment and keep the API rewrite before the SPA fallback. The Vite development proxy is not included in the static build; `API_PROXY_TARGET` is local development configuration.

The same-origin API path supports the administrator portal's Secure HttpOnly SameSite=Strict refresh-cookie flow. Set the backend's `AUTH_ALLOWED_ORIGINS` to the exact deployed administrator HTTPS origin.

After deployment, run the read-only deployment check:

```bash
npm run check:deployment --workspace=admin-web -- https://your_admin_host.vercel.app
```

It checks SPA routes, API forwarding, unauthenticated rejection, and credentialed CORS. Complete a staff password/OTP sign-in and reload in a browser to verify session continuity.

## Further documentation

- [Mobile application](frontend/README.md)
- [Administrator portal and hosting](admin-web/README.md)
- [Authentication deployment and migration history](backend/AUTH_DEPLOYMENT.md)
- [Supabase authentication setup](backend/AUTH_MIGRATION.md)
- [Administrator security and permissions](backend/ADMIN_SECURITY.md)
- [AI provider configuration](backend/SCAN_CONFIGURATION.md)
- [Plant-scoped telemetry and database constraints](backend/TELEMETRY_PHASE_A.md)
- [Simulated demo telemetry](backend/DEMO_TELEMETRY.md)
- [Password hashing and runtime setup](backend/PASSWORD_HASHING.md)
- [ESP32 firmware](hardware/firmware/README.md)
