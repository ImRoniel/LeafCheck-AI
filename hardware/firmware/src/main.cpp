/**
 * Leaf-Check-AI ESP32 Hardware Firmware
 * Hardware Sensor Telemetry Reader (Soil Moisture, pH, PAR Light)
 */

#include <Arduino.h>

// Pin Definitions
#define SOIL_MOISTURE_PIN 34
#define PH_SENSOR_PIN     35
#define PAR_LIGHT_PIN     32

void setup() {
  Serial.begin(115200);
  pinMode(SOIL_MOISTURE_PIN, INPUT);
  pinMode(PH_SENSOR_PIN, INPUT);
  pinMode(PAR_LIGHT_PIN, INPUT);
  Serial.println("[Leaf-Check-AI] Hardware Firmware Initialized.");
}

void loop() {
  int rawSoil = analogRead(SOIL_MOISTURE_PIN);
  int rawPH   = analogRead(PH_SENSOR_PIN);
  int rawPAR  = analogRead(PAR_LIGHT_PIN);

  // Convert raw readings
  float soilPct = map(rawSoil, 4095, 0, 0, 100);
  float phVal   = (rawPH / 4095.0) * 14.0;
  float parPPFD = (rawPAR / 4095.0) * 2000.0;

  Serial.printf("[Telemetry] Soil: %.1f%% | pH: %.2f | PAR: %.1f PPFD\n", soilPct, phVal, parPPFD);

  delay(5000);
}
