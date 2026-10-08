# Batch 3 implementation notes

## Scope

- Backend source and mocked unit tests only.
- No schema or dependency changes. No external database, curator, or calendar calls are used by the new tests.

## Expired sessions

Expired `app_sessions` cleanup now runs from the general worker independently of calendar configuration and calendar-sync outcomes. A successful cleanup is throttled in-process for 24 hours; a failed cleanup is retried after five minutes rather than on every 30-second worker pass. Cleanup uses the strict `expires_at < current time` boundary, the existing `expires_at` column, and no new database objects.

## Mail classification recovery

- Per-message retry state is stored in the existing `mail_messages.data` JSON under the reserved `_classificationRetry` key.
- State has a strict versioned shape: `{version: 1, attempts, nextAttemptAt}`. Malformed state is treated as invalid and immediately eligible rather than being allowed to defer a message indefinitely.
- Failures use exponential delays beginning at 30 seconds with additive jitter of 0–20%; the total delay, including jitter, is capped at six hours.
- Candidate selection keyset-scans in bounded 100-row pages until it finds eligible work, so any number of newer backed-off messages cannot starve an older eligible message. Invalid retry deadlines are treated as ready without database timestamp casts. State is database-backed and therefore survives worker restarts.
- The existing current-day classification policy remains unchanged for ordinary unclassified mail. A prior-day message carrying retry metadata remains eligible so a failure near midnight is not permanently abandoned; this does not enroll other older mail.
- A successful classification atomically stores the analysis and removes retry state.
- Saving manual rules clears analysis and retry state for the same current-day, non-overridden rows that were already intended for reclassification.
- Mail reingestion removes curator-supplied reserved metadata and merges new data over the cached row without removing cached retry state.
- Classification payloads select only explicit public message fields. Snapshot, paging, and briefing responses remove retry metadata in SQL and again in application code as defense in depth.

## Test seams

Classifier dependencies accept an injected curator, clock, and random source. Session cleanup accepts an injected clock, and mail sync accepts an injected curator. Unit tests use mocked pools and do not require live services.
