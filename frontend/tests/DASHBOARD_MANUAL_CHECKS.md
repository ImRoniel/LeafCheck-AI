# Dashboard checks

- Confirm a single greeting, date, plant count and profile button appear above Daily Digest and the photo strip. Permanent Scan/Pair banners, Alerts and Coming soon are absent.
- With physical LC-A50528 linked and a sample less than 30 minutes old, confirm Receiving readings, the printed ID and last-update time. Open its plant to inspect the exact timestamp and growing conditions.
- Check no sample, stale sample, future/invalid timestamp, request failure and refresh recovery. Pairing alone must not claim live readings.
- Demo readings never count as physical sensors receiving readings. Mixed gardens expose a sensor sheet with source labels and exact timestamps.
- Verify Care Tasks opens Today for due-today care, and All dates for overdue-only care. Verify the attention row, View all, and Add your first plant all open the same MY SPACES screen as the bottom tab, with no legacy Garden filters. Saved Garden links also redirect to MY SPACES.
- Scan activity counts distinct plants on the local calendar day. A capped archive whose oldest entry is still today uses a + count; it must not imply a complete total.
- Photos use saved plant images and recover to a leaf fallback on failure. At most three cards appear; critical and warning plants come first. Saved health must not be presented as freshly measured.
- Loading/failure states do not show false all-clear messages. Retry and pull-to-refresh refresh plants, care, scans and readings. Work stops on blur/background; signing out clears account data.
- Empty gardens offer Add your first plant. Guest gardens omit server scan/sensor activity and navigate to local spaces.
- Check 320px width, large text, screen-reader labels, touch targets, reduced-motion sheets and bottom-navigation clearance.
- Manage Devices shows server-linked physical sensors separately from local demo assignments.
