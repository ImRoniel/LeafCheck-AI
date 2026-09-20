# LeafCheck ESP32 firmware

## Local configuration

Copy [the tracked template](src/config.template.h) to [the local configuration](src/config.h)
in the same source directory. Edit only the local copy. Supply your WiFi details,
the full telemetry endpoint reachable from the ESP32, and a registered device ID.
The example endpoint deliberately uses a reserved, non-production domain.
There is currently no API-token authentication in the firmware's HTTP request.

The [firmware ignore rules](.gitignore) ignore local configuration headers in this
subtree, while allowing the template to be committed. Never force-add local
credentials. Ignore rules do not remove files already tracked by Git; if secrets
were previously committed, rotate them and coordinate repository cleanup.

Verify the template's pin assignments against your ESP32 board: I2C SDA 21,
SCL 22, and analog soil input GPIO 34. Sensors use I2C addresses 0x44 (SHT31)
and 0x23 (BH1750). The default sampling interval is 15 seconds.

## Soil calibration and electrical limits

The firmware explicitly uses a 12-bit ADC (0–4095). The template's dry and wet
values are examples, not a calibration for your sensor. Measure the raw ADC in
dry and wet reference conditions using the same board and ADC configuration,
then update the local configuration. Keep the sensor's electronics out of water
and its output within the ESP32's safe voltage limits.

Calibration must satisfy: zero < wet < dry < 4095. Equal, reversed, or rail
endpoints are invalid. Raw readings at either ADC rail are conservatively rejected
as possible electrical faults or saturation. Non-rail readings beyond valid
calibration endpoints still clamp to 0% or 100%, preserving genuine dry/wet states.

**Limitation:** an unplugged analog pin can float to a plausible midrange value.
Software range validation cannot identify every analog disconnection. Reliable
disconnect detection may need a suitable bias circuit or hardware diagnostics;
verify that any circuit changes do not distort calibration.

## Telemetry reliability

Every required measurement must be valid before JSON serialization or HTTP POST:

- SHT31: finite temperature within -40 to 125 degrees C and humidity within 0–100%.
- BH1750: finite, non-negative lux; negative error codes are never replaced by zero.
- Soil: valid calibration, non-rail ADC reading, and finite converted percentage.

Invalid cycles emit a local diagnostic, make no HTTP request, and wait the normal
sampling interval. No stale values or partial payloads are sent. Digital sensor
initialization failures are retained; failed sensors are retried once per loop.
After BH1750 initialization/reinitialization, its maximum conversion-time readiness
check must pass before a reading is used. Recovery may skip an extra cycle.
Legitimate zero lux, zero degrees C, and zero percent soil moisture remain valid.

Existing payload fields, rounding, HTTP response handling, and WiFi reconnection
behavior are unchanged. Timestamps remain server-assigned. Skipped cycles appear
as gaps in telemetry rather than false zeros.

## Build and manual verification

Install PlatformIO Core or the VS Code PlatformIO extension separately. After
creating the local configuration, open this directory as the PlatformIO project
and build the ESP32 environment from [the project settings](platformio.ini).
Use the upload action only with the intended board connected. Open the serial
monitor at 115200 baud.

Verify with a test endpoint that can count received requests:

| Scenario                                     | Expected result                                     |
| -------------------------------------------- | --------------------------------------------------- |
| All sensors healthy                          | One normal request per successful cycle             |
| SHT31 missing at boot or disconnected later  | Error, no POST, periodic reinitialization           |
| BH1750 missing or read fails                 | Error, no POST, no zero substitution                |
| Reconnect a failed digital sensor            | Initialization recovery, then fresh valid telemetry |
| Cover BH1750 completely                      | Valid zero lux is allowed                           |
| Valid temperature of zero degrees C          | Accepted                                            |
| Equal/reversed/out-of-range soil calibration | Error and no POST                                   |
| Soil raw reading at 0 or 4095                | Suspect-reading diagnostic and no POST              |
| Valid dry/wet soil endpoint                  | Valid 0%/100% is allowed                            |
| WiFi unavailable                             | Existing bounded reconnect attempt and cycle skip   |

Inject non-finite sensor results with test doubles or a temporary test build to
verify rejection of NaN/infinity. Do not intentionally short powered sensor lines
or exceed ESP32 voltage limits to simulate ADC faults. Confirm the absence of
requests at the test endpoint, not just the presence of serial warnings.
