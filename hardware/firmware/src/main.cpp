/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LeafCheck ESP32 Firmware
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Sensors:
 *   - SHT31     (I2C 0x44) — Temperature (°C) & Relative Humidity (%)
 *   - BH1750    (I2C 0x23) — Ambient Light Level (lux)
 *   - Capacitive Soil Moisture Sensor (Analog GPIO 34)
 *
 * Transport:
 *   HTTP POST → Express Backend every READ_INTERVAL_MS (default 15s)
 *
 * Payload keys (must match backend schema exactly):
 *   deviceId, temperature, humidity, soilMoisture, soilMoistureRaw, lightLevel
 *
 * NOTE: No timestamp is sent — the server assigns an authoritative timestamp.
 * NOTE: No pH sensor — pH is botanical reference data, not live telemetry.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Adafruit_SHT31.h>
#include <BH1750.h>
#include "config.h"

// ─── Sensor Instances ────────────────────────────────────────────────────────
Adafruit_SHT31 sht31 = Adafruit_SHT31();
BH1750 lightMeter;

// ─── Forward Declarations ────────────────────────────────────────────────────
void connectWiFi();
float mapSoilMoisture(int rawValue);

// ═════════════════════════════════════════════════════════════════════════════
// SETUP
// ═════════════════════════════════════════════════════════════════════════════

void setup() {
  Serial.begin(115200);
  delay(1000); // Allow serial monitor to attach
  Serial.println();
  Serial.println("╔═══════════════════════════════════════════╗");
  Serial.println("║   LeafCheck ESP32 Firmware v1.0           ║");
  Serial.println("║   SHT31 + BH1750 + Soil Moisture         ║");
  Serial.println("╚═══════════════════════════════════════════╝");
  Serial.println();

  // ── Initialize I2C Bus ──────────────────────────────────────────────────
  Wire.begin(I2C_SDA, I2C_SCL);
  Serial.printf("[I2C] Bus initialized (SDA=%d, SCL=%d)\n", I2C_SDA, I2C_SCL);

  // ── Initialize SHT31 (Temperature & Humidity) ──────────────────────────
  if (!sht31.begin(0x44)) {
    Serial.println("[ERROR] SHT31 not found at 0x44! Check wiring.");
  } else {
    Serial.println("[  OK ] SHT31 initialized (temp + humidity).");
    // Enable the internal heater briefly to clear condensation on first boot
    sht31.heater(false);
  }

  // ── Initialize BH1750 (Ambient Light) ──────────────────────────────────
  if (!lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE)) {
    Serial.println("[ERROR] BH1750 not found! Check wiring.");
  } else {
    Serial.println("[  OK ] BH1750 initialized (ambient light).");
  }

  // ── Initialize Soil Moisture Pin ───────────────────────────────────────
  pinMode(SOIL_MOISTURE_PIN, INPUT);
  Serial.printf("[  OK ] Soil moisture pin GPIO %d configured.\n", SOIL_MOISTURE_PIN);

  // ── Connect to WiFi ────────────────────────────────────────────────────
  Serial.println();
  connectWiFi();

  Serial.println();
  Serial.println("[LeafCheck] Setup complete. Entering telemetry loop...");
  Serial.println();
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ═════════════════════════════════════════════════════════════════════════════

void loop() {
  // ── Ensure WiFi Connectivity ───────────────────────────────────────────
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Connection lost — reconnecting...");
    connectWiFi();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[WiFi] Reconnection failed — skipping this cycle.");
      delay(READ_INTERVAL_MS);
      return;
    }
  }

  // ── Read SHT31 (Temperature & Humidity) ────────────────────────────────
  float temperature = sht31.readTemperature();
  float humidity    = sht31.readHumidity();

  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("[WARN] SHT31 returned NaN — sensor may be disconnected.");
    delay(READ_INTERVAL_MS);
    return;
  }

  // ── Read BH1750 (Ambient Light) ────────────────────────────────────────
  float lux = lightMeter.readLightLevel();
  if (lux < 0) {
    Serial.println("[WARN] BH1750 returned negative value — using 0.");
    lux = 0;
  }

  // ── Read Capacitive Soil Moisture ──────────────────────────────────────
  int soilRaw = analogRead(SOIL_MOISTURE_PIN);
  float soilPct = mapSoilMoisture(soilRaw);

  // ── Build JSON Payload ─────────────────────────────────────────────────
  // Keys MUST match the Express backend validation schema exactly.
  JsonDocument doc;
  doc["deviceId"]        = DEVICE_ID;
  doc["temperature"]     = round(temperature * 100.0) / 100.0;  // 2 decimal places
  doc["humidity"]        = round(humidity * 100.0) / 100.0;
  doc["soilMoisture"]    = round(soilPct * 10.0) / 10.0;        // 1 decimal place
  doc["soilMoistureRaw"] = soilRaw;
  doc["lightLevel"]      = round(lux * 10.0) / 10.0;

  String payload;
  serializeJson(doc, payload);

  Serial.printf("[Telemetry] %s\n", payload.c_str());

  // ── HTTP POST to Backend ───────────────────────────────────────────────
  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000); // 10-second timeout

  int httpCode = http.POST(payload);

  if (httpCode > 0) {
    String response = http.getString();
    if (httpCode == 201) {
      Serial.printf("[HTTP] ✓ 201 Created — reading stored.\n");
    } else if (httpCode == 404) {
      Serial.printf("[HTTP] ✗ 404 — device ID not registered in backend.\n");
    } else if (httpCode == 400) {
      Serial.printf("[HTTP] ✗ 400 Bad Request — %s\n", response.c_str());
    } else {
      Serial.printf("[HTTP] Response %d: %s\n", httpCode, response.c_str());
    }
  } else {
    Serial.printf("[HTTP] POST failed: %s\n", http.errorToString(httpCode).c_str());
  }

  http.end();

  // ── Wait for Next Cycle ────────────────────────────────────────────────
  delay(READ_INTERVAL_MS);
}

// ═════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Connects to WiFi with retry logic.
 * Blocks until connected or max attempts (20s) exceeded.
 */
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[WiFi] Connecting to \"%s\"", WIFI_SSID);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected! IP: %s  RSSI: %d dBm\n",
                  WiFi.localIP().toString().c_str(),
                  WiFi.RSSI());
  } else {
    Serial.println("\n[WiFi] Connection FAILED — will retry on next loop.");
  }
}

/**
 * Maps raw capacitive soil moisture ADC value to 0–100%.
 * Calibration constants are defined in config.h.
 *
 * Capacitive sensors output:
 *   - HIGH ADC in air (dry)   → SOIL_CAL_DRY
 *   - LOW  ADC in water (wet) → SOIL_CAL_WET
 */
float mapSoilMoisture(int rawValue) {
  float percentage =
      (float)(SOIL_CAL_DRY - rawValue) /
      (float)(SOIL_CAL_DRY - SOIL_CAL_WET) * 100.0f;
  return constrain(percentage, 0.0f, 100.0f);
}
