<!--
  🌿 LeafCheck AI — Pull Request Template

  Thank you for contributing! Please fill out the sections below as completely as possible.
  If a section does not apply to your PR (e.g., frontend changes for a backend-only PR),
  mark it as [N/A] rather than deleting it.
-->

## 📌 PR Title Format

<!-- Please use Conventional Commits format:
     type(scope): brief description
     Examples:
       feat(ar): add 3D leaf moisture overlay model
       fix(db): correct user_id index mapping in Prisma 7 schema
       security(api): enforce rate limiting on IoT ingestion route
       chore(hardware): update ESP32 payload schema validation
-->

Closes Issue: # <!-- Enter issue number here (e.g., #42) -->

---

## 📝 Summary & Context

<!-- Provide a concise summary of what this PR introduces, fixes, or refactors.
     Explain the "why" behind the change, not just the "what". -->

---

## 🛠️ Type of Change

Select all that apply:

- [ ] 🎨 **Frontend / UI**: Expo React Native, component updates, styling.
- [ ] 🕶️ **3D & AR**: ViroReact, Expo-Three, Three.js models, shaders, or tracking logic.
- [ ] 🗄️ **Backend & DB**: Prisma 7 schema updates, migrations, Supabase BaaS, raw SQL.
- [ ] 🔌 **API & Security**: REST endpoints, JWT verification, rate limiting, Zod validation.
- [ ] 🤖 **AI / ML**: Custom model pipeline updates, Google AI Studio (Gemini) fallback logic.
- [ ] ⚡ **Hardware / IoT**: Microcontroller (ESP32) payload handling, metric ingestion.
- [ ] 🐛 **Bug Fix**: Non-breaking fix for an existing issue.
- [ ] ⚠️ **Breaking Change**: Fix/feature that requires downstream changes or manual migration steps.

---

## 🛡️ Architecture & Security Checklist

_This section ensures our system remains secure, performant, and resilient against hardware or API failures._

### 1. Backend, API & Database (Supabase + Prisma 7)

- [ ] **Parameterized Queries**: All database calls use Prisma ORM or parameterized SQL (no string concatenation).
- [ ] **Input Validation**: Incoming payload data is strictly validated using Zod (or equivalent runtime schema validation).
- [ ] **Auth & Session**: Endpoints are protected via Supabase JWT verification / Bearer tokens where required.
- [ ] **Security Controls**: Sensitive actions adhere to rate-limiting, secure headers (TLS/HTTPS), and hashing standards (e.g., bcrypt for secrets).
- [ ] **Migrations**: Database schema changes include a generated, tested Prisma migration script (`npx prisma migrate dev`).

### 2. Hardware / IoT Ingestion (ESP32 Nodes)

- [ ] **Graceful Degradation**: System handles missing, noisy, or offline IoT sensor metrics (pH, moisture, lux, temp) without throwing unhandled crashes.
- [ ] **Payload Safety**: Device MAC/API key authentication is checked before DB write operations.

### 3. AI Pipeline (Custom Model + Google AI Studio)

- [ ] **Fallback Logic**: If the primary AI pipeline or Google AI Studio callback times out or fails, a user-safe fallback or cached state is returned.
- [ ] **Sanitization**: Raw AI output is safely parsed before rendering to the mobile client.

### 4. Frontend, 3D & AR (Expo + Three.js / ViroReact)

- [ ] **Memory Management**: 3D assets (`.gltf`/`.glb`), geometries, materials, and textures are explicitly disposed of when unmounted to avoid memory leaks.
- [ ] **Performance**: Maintained target frame rates (~60 FPS) on mobile devices without overheating or throttling.
- [ ] **Cross-Platform**: Tested on both iOS and Android platforms/emulators.

---

## 🧪 How Has This Been Tested?

<!-- Describe the tests you ran to verify your changes.
     Provide instructions so the reviewer can reproduce your test environment. -->

- [ ] **Local Integration Test**: Tested end-to-end data flow manually.
- [ ] **Hardware Bench Test**: Verified using simulated payload or physical ESP32 node.
- [ ] **Unit / Automated Tests**: Added or updated test coverage (`npm test`).

### Test Commands Executed:

```bash
# Example: npm test, npx prisma migrate dev, etc.
```
