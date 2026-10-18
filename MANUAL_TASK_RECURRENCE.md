# Manual-task recurrence compatibility contract (v1)

This is the storage/sync compatibility layer only. It creates no templates or
occurrences and introduces no recurrence UI, scheduler, provider call or planner
behavior. Records live additively in the existing versioned `manual-tasks`
collection. No schema migration or separate collection is required.

## Exact bounded metadata

Legacy tasks omit `recurrence` and remain valid. If present, `recurrence` must be
one of these exact objects (all shown keys required; no extra keys):

```json
{"version":1,"kind":"template","frequency":"weekly","weekday":5,"startDate":"2026-10-02","paused":false}
```

- Template `id` is a stable, caller-created identifier matching
  `[a-zA-Z0-9_.-]{1,80}`. Updating its weekly settings retains that ID.
- `weekday` is an integer from 0 (Sunday) to 6 (Saturday).
- `startDate` is a real civil date in exact `YYYY-MM-DD` form, an inclusive
  recurrence start boundary; it need not itself match `weekday`.
- `paused` is a required boolean. Pausing/deleting the template is the future
  materializer's stop signal; existing occurrences are independent.

```json
{"version":1,"kind":"occurrence","templateId":"weekly-example","sourceDate":"2026-10-09"}
```

- `templateId` matches the same 1–80 character identifier rule.
- `sourceDate` is a real civil `YYYY-MM-DD` date, the immutable occurrence key.
- Record `id` is exactly `occ.${templateId}.${sourceDate}` (at most 95 characters).
  No timezone or precise due time is inferred.
- The ordinary task `date` can be edited independently of `sourceDate`.
  Title, notes, important/completed/deleted states are also independent.
- A template need not be present to validate an occurrence (offline merge,
  tombstones and ordering must not depend on foreign-key availability).
- A record's recurrence kind cannot be changed or removed once present, and an
  occurrence's entire recurrence object is immutable. Use tombstones for deletion.

All existing required task fields and limits remain: nonblank title <=240,
notes <=4000, valid dated task, boolean completion, optional important/deleted
booleans, unique IDs, and at most **10,000 records including tombstones**.
Visible context/due wording belongs in `notes`; this contract assigns no separate
category field or exact due time. Top-level unknown JSON fields are retained;
unknown recurrence versions/keys are rejected, not guessed.

## Preservation, equality and conflicts

Web and patched Android compare all JSON metadata recursively, ignoring object
key ordering but preserving array ordering. Optional legacy booleans normalize
to false. Android normalization and local edits clone the complete JSON object;
deletion writes a tombstone. Omission during client three-way merge becomes a
tombstone, including completion and recurrence/source metadata. A deleted record
wins a first-contact live/deleted collision; other concurrent edits still require
explicit conflict resolution. Recurrence-only changes are real edits.

Web locked storage rejects stale expected records, recurrence stripping and
oversized collections without writing. Both clients reject detectable recurrence
stripping/kind/source changes during merge, even with an explicit conflict choice.
An unchanged peer alongside a new recurrence-bearing record of the same ID is
also treated conservatively: introducing recurrence uses a new stable template ID,
not conversion of an existing one-off task.

The backend validates before connecting to storage, then under the existing
collection lock rejects removal/omission of existing recurrence metadata, source
changes, and physical omission of existing tombstones with **409**. Invalid shapes
receive **400**. These checks precede the stale-version no-op shortcut. Exact
metadata-aware no-ops remain safe with a stale version; any real edit requires the
current version. Unknown top-level fields omitted by legacy projections are
retained from the previous record where safe; supplied replacement values remain
versioned changes. Unknown fields cannot be deleted by omission (use an explicit
JSON value such as null). Nested objects, if supplied, are whole replacement values.

## Old-client boundary and deferred work

An already installed, unpatched Android/web client **does not become safe** through
this source change. It may still discard metadata locally or show templates as
ordinary dated tasks. With the repaired backend, distinguishable stripped writes
are rejected atomically, retaining server records; the client must update and
retry. Before the backend repair is active, that server protection does not exist.
Loss before the server ever sees metadata, fabricated new IDs, and deliberate
valid edits cannot be distinguished from normal writes. No protocol can recover
metadata that was already lost. Unknown nested-field deletion via a supplied
replacement object is likewise indistinguishable from an intended edit.

This patch does not hide template records in the existing UIs. No recurring
templates should be created until the separately approved UI/materialization
slice is complete and all participating clients are compatible. That slice must
define an explicit finite local-date materialization window and honor this stable
source key, pause state, completed instances and tombstones. **This patch's
materialization window is empty: it materializes zero records.**

The debug Android unit suite was safely verified offline using the cached Gradle
8.11.1 executable and normal Gradle cache, with a dedicated empty
`build/hermes-test-home` passed as JVM `user.home` and through `JAVA_TOOL_OPTIONS`
so signing properties are not read. Use this signing-free setup for debug unit
checks; release/signing tasks remain out of scope.
