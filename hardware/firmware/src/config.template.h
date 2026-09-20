#ifndef LEAFCHECK_CONFIG_H
#define LEAFCHECK_CONFIG_H

// Copy this file to config.h in the same directory; edit ONLY the ignored copy.
// Never put real credentials in this tracked template or force-add config.h.
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// Replace with the actual telemetry endpoint reachable from the ESP32.
// example.invalid intentionally cannot serve as a production endpoint.
#define SERVER_URL "http://example.invalid/api/telemetry"
#define DEVICE_ID "YOUR_REGISTERED_DEVICE_ID"
// The current firmware does not implement API-token authentication.

// Example ESP32 DevKit wiring; confirm against your board and connections.
#define I2C_SDA 21
#define I2C_SCL 22
#define SOIL_MOISTURE_PIN 34
#define READ_INTERVAL_MS 15000UL

// EXAMPLE ONLY: calibrate your own sensor using the firmware's 12-bit ADC.
// Require 0 < wet < dry < 4095. Keep electronics out of water.
#define SOIL_CAL_DRY 3000
#define SOIL_CAL_WET 1200

#endif
