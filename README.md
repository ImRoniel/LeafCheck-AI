<div align="center">

  <h1>🌿 Leaf-Check-AI</h1>
  <h3>Smart Indoor Plant Health Monitor</h3>
  <p><b>Real-Time IoT Diagnostics & AR-Enhanced Care Powered by AI Computer Vision</b></p>

  <p>
    <a href="https://github.com/ImRoniel/Agri-Sense-AI/stargazers"><img src="https://img.shields.io/github/stars/ImRoniel/Agri-Sense-AI?style=for-the-badge&color=2e7d32" alt="Stars"></a>
    <a href="https://github.com/ImRoniel/Agri-Sense-AI/network/members"><img src="https://img.shields.io/github/forks/ImRoniel/Agri-Sense-AI?style=for-the-badge&color=2e7d32" alt="Forks"></a>
    <a href="https://github.com/ImRoniel/Agri-Sense-AI/blob/main/LICENSE"><img src="https://img.shields.io/github/license/ImRoniel/Agri-Sense-AI?style=for-the-badge&color=2e7d32" alt="License"></a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/React_Native-20232A?style=flat-square&logo=react&logoColor=61DAFB" alt="React Native">
    <img src="https://img.shields.io/badge/Expo-1B1F23?style=flat-square&logo=expo&logoColor=white" alt="Expo">
    <img src="https://img.shields.io/badge/ESP32-E7352C?style=flat-square&logo=espressif&logoColor=white" alt="ESP32">
    <img src="https://img.shields.io/badge/Gemini_API-8E75B2?style=flat-square&logo=googlebard&logoColor=white" alt="Gemini">
  </p>

  <hr width="80%" />
</div>

---

## 📌 Project Overview

**Leaf-Check-AI** bridges nature and modern technology by transforming houseplant maintenance. Utilizing a continuous multi-sensor IoT network paired with AI-driven computer vision, the platform monitors plant vital signs in real time.

By projecting **Augmented Reality (AR) 3D overlays** directly over physical houseplants, Leaf-Check-AI empowers both home "plant parents" and commercial office managers to optimize care, prolong plant longevity, maximize indoor air purification, and enhance psychological well-being.

---

## 💻 Tech Stack

Our architecture is built for real-time responsiveness, seamless cross-platform delivery, and edge-computing capabilities.

- **📱 Frontend & Mobile:** React Native | Expo
- **🕶️ Augmented Reality:** Expo GL (Three.js) or React Three Fiber (R3F) for rendering 3D plant health overlays.
- **🧠 Artificial Intelligence:**
  - _Primary:_ Gemini API for seamless integration and intelligent diagnostics.
  - _Fallback/Custom:_ Open-source Python models trained for specific species/pest recognition.
- **🗄️ Backend & Database:**
  - _Cloud BaaS:_ Supabase or Firebase (Main database for real-time telemetry and user auth).
  - _Local Storage:_ SQLite3 (Utilized for system logs, admin controls, and offline data caching).
- **⚙️ Hardware:** ESP32 Microcontroller (Powers the IoT multi-sensor array).

---

## 🚨 The Problem vs. 💡 The Solution

<table width="100%">
  <tr>
    <td width="50%" valign="top">
      <h3 align="center">❌ Traditional Care</h3>
      <ul>
        <li><b>Delayed Symptom Detection:</b> Manual inspection catches issues like root rot or scorch only after irreversible damage occurs.</li>
        <li><b>Care Misalignment:</b> High rate of plant mortality due to overwatering, light stress, and misidentified species needs.</li>
        <li><b>Pest Outbreaks:</b> Unnoticed microscopic pests (mealybugs, spider mites) spread rapidly across foliage.</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3 align="center">✅ Leaf-Check-AI Solution</h3>
      <ul>
        <li><b>Proactive IoT Monitoring:</b> Continuous tracking of micro-climate metrics like Photosynthetically Active Radiation (PAR) and root zone pH.</li>
        <li><b>AI Visual Health Diagnostics:</b> Instant species identification and sub-surface pest/foliar disease classification.</li>
        <li><b>3D AR HUD Interface:</b> Interactive health metrics floating directly over physical plants in real time.</li>
      </ul>
    </td>
  </tr>
</table>

---

## ✨ Key Features

<br/>

<table>
  <tr>
    <td width="50%">
      <h3>📡 1. IoT Multi-Sensor Array</h3>
      <p>Tracks subterranean soil moisture, pH level, ambient temperature, and light intensity (calibrated in <i>foot-candles</i>) tailored to specific plant sensitivity thresholds.</p>
    </td>
    <td width="50%">
      <h3>👁️ 2. AI-Powered Vision</h3>
      <p>Computer vision model automatically identifies species and scans foliage for micro-pests (e.g., mealybugs, spider mites) and early foliar pathogen manifestations.</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h3>🕶️ 3. AR Live HUD</h3>
      <p>Point your mobile device camera at any registered plant to project an interactive 3D contextual overlay showing real-time health indicators and vital stats.</p>
    </td>
    <td width="50%">
      <h3>🔔 4. Smart Care Alerts</h3>
      <p>Automated, action-driven notifications informing you precisely when to water, adjust humidity levels, or fertilize based on cultural requirements.</p>
    </td>
  </tr>
</table>

### 📊 5. Biophilic Analytics Dashboard

A centralized mobile hub providing historical health trends, telemetry charts, and metrics evaluating your plant's direct contribution to indoor air quality.

---

## 🪴 Supported Plant Care Categories

Leaf-Check-AI intelligently adjusts its threshold alerts based on standard indoor horticultural profiles:

| Category           | Light Intensity Range | Target Species Examples                    | Key Focus Areas                                      |
| :----------------- | :-------------------: | :----------------------------------------- | :--------------------------------------------------- |
| **Low-Light**      |    `25 – 75 ft-c`     | Chinese Evergreen, Cast Iron Plant, Pothos | Moisture retention, root rot prevention              |
| **Medium-Light**   |    `75 – 200 ft-c`    | Ferns, Rubber Plants, Norfolk Island Pine  | Humidity monitoring, ambient heat management         |
| **High-Light**     |     `> 200 ft-c`      | Cacti, Succulents, Orchids, Culinary Herbs | PAR light exposure tracking, precise drainage        |
| **Specialty Care** |       _Varies_        | Dracaena, Calathea, Sensitive Foliage      | Fluorine sensitivity checks, strict humidity control |

> [!NOTE]
> Light values are measured dynamically in **foot-candles (ft-c)** and cross-referenced with Photosynthetically Active Radiation (PAR) ranges suitable for indoor photosynthesis.

---

## 🚀 Getting Started

### Prerequisites

- **Hardware:** ESP32 board equipped with soil moisture, pH, and PAR light sensor modules.
- **Software:** Node.js, Expo CLI, and a mobile device for testing the React Native AR environment.

### Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/ImRoniel/Agri-Sense-AI.git](https://github.com/ImRoniel/Agri-Sense-AI.git)
   cd Agri-Sense-AI
   ```
