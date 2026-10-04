# Persistent Android sign-in

Implemented on feature/android-persistent-login; backend session lifetime unchanged (24 hours).

- Android Keystore AES-GCM key encrypts the session cookie; ciphertext is atomically stored in noBackupFilesDir. Passwords are not persisted.
- On startup validate the saved, unexpired session with /api/v1/auth/session before opening connected views. Network failure retains the cookie and offers Retry / Forget saved sign-in / Continue locally.
- Expiry, rejected authentication and invalid encrypted storage require sign-in again. Logout clears the local cookie and in-memory snapshots even if its network request fails; failed remote revocation is disclosed.
- Cookie is restricted to HTTPS, exact origin, HttpOnly host-only daymark_session with path /. Unrelated response cookies cannot erase it.
- Workspace snapshots remain memory-only. This is not offline data caching or a refresh-token implementation.

Verification: assembleDebug, JVM unit tests and lintDebug. Seven new session tests cover process-like cookie-store reconstruction, expiry, local logout, unrelated cookies, origin/transport isolation, malformed stored cookies, server deletion cookies. These use an in-memory storage double; they do not prove Android Keystore/device behavior.

Device acceptance still required: install over the prior APK; log in; force-stop and reopen within 24 hours; reboot and reopen; reopen offline then reconnect/retry; log out and reopen; validate expired/revoked sessions. Do not use real credentials in unit tests or commit private data. No real-phone or production login test was performed in this change.
