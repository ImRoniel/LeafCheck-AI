# Scenes 3–7 device checks

Automated storage and schedule tests are in [local-state.test.ts](local-state.test.ts).
Native/browser rendering and real API integration still require these checks:

1. Enter as guest: choose experience, save an empty space, add a local plant,
   select manual mode, edit schedule, and finish. Confirm Home/Spaces show the
   plant and empty spaces. Restart and confirm setup does not repeat.
2. At each saved setup step, restart and confirm the same step resumes. Opening
   a different setup deep link must redirect to saved progress.
3. Skip at each step, then use Resume setup in the collection. Completed setup
   offers Review care schedule and restores saved inputs.
4. Sign in/register: setup must use the authenticated account's namespace and
   API collection, never import guest plants implicitly. Switch accounts and
   confirm local preferences and plants do not leak across accounts.
5. Select an existing server plant, or create one; double-tap Continue. After a
   successful creation followed by a failed local save, retry without a second
   creation. After an ambiguous network error, refresh and select the saved
   server plant. The locked API has no idempotency contract.
6. Deny storage access or seed malformed data: show recovery rather than replacing
   saved data with defaults. Restore storage access and retry.
7. Try blank names, invalid intervals, invalid amount, and invalid 24-hour time.
   Validation must keep inputs visible and avoid marking setup complete.
8. Exercise Back, Skip, screen-reader selection announcements, large text,
   keyboard interaction, small screens, and Android hardware Back.
9. Confirm pairing is disabled and the manual path always works. No Bluetooth
   discovery, delivery data, numeric health score, or notifications are fabricated.

Care preferences and guest data are local-only. SecureStore remains dedicated
to existing authentication credentials. Unknown storage versions fail closed;
future versions require explicit migrations rather than silently resetting data.
