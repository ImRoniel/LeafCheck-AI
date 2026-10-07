# Installation intro: native acceptance

Use rebuilt iOS/Android binaries containing `InstallOnboarding`; Expo Go and an
OTA-only update are insufficient. Record version/build, OS/device, installation
method, backup/transfer mechanism, date, observed outcomes and artifact references
in `.prd/frontend-install-verification-v4.md`. Use test accounts; never record tokens.

1. Fresh install, no credentials: branded splash → all three slides → login.
2. Fresh install/new device with a valid test session: same splash/slides; final
   action skips login and resumes saved garden setup or reaches Home as appropriate.
3. Complete intro and relaunch. Intro stays complete through sign-out, login to a
   second account and guest access; garden data stays account-scoped.
4. Remove/reinstall the app and clear Android app data. Intro repeats. On iOS test
   with a retained Keychain credential: intro still precedes authenticated routes;
   the app must not proactively delete that credential.
5. Complete intro on source device, back up and restore to a second device. Also
   perform device-to-device transfer. Verify garden data can be restored while the
   intro marker is absent. Exercise both cloud restore and direct transfer on each
   platform; record the actual mechanism rather than assuming backup flags prove it.
6. Inspect built native integration: Android marker under `noBackupFilesDir`; iOS
   Application Support directory/file explicitly excluded from backup. SecureStore
   key/service and device-only accessibility stay unchanged; Android SecureStore
   entries stay excluded; no synchronizable attributes/shared access group added.
7. Open Home/setup/login/terms deep links before intro completion; try hardware Back.
   Neither deep links nor guest effects can bypass splash/slides.
8. Slow/offline/expired-session restoration while traversing slides. A late successful
   restore leaves the current slide intact; after completion existing recovery applies.
9. Inject marker read/write denial and malformed/unsupported content on a test build.
   Observe generic retry, no overwritten garden data, no navigation before save,
   double-tap coalescing, and successful retry after restoring storage access.
10. Review large text, screen-reader page controls and saving/retry feedback, reduced
    motion, safe areas, existing artwork/layout and Android Back.

Mark unavailable prerequisites/results **unverified**. Automated tests, module
autolinking and static source inspection are supporting evidence, not native lifecycle proof.
