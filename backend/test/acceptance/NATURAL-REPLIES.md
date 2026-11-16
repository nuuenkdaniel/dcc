# Finite natural-reply acceptance (parent opt-in only)

This harness is prepared source, not executed/model acceptance. It uses the
candidate production `run_action`, official Hermes bootstrap/SDK, fixed
`gpt-6-luna` policy and existing fixed-loopback MCP relay. It never substitutes
scripted final text. No installed runtime/bridge is changed.

## Contract and paired rollout

Authenticated discovery advertises `conversationReplyVersion:1`. Only opted-in
start bodies add `replyVersion:1`; that choice participates in the immutable
conversation fingerprint and is retained for typed answer turns. The existing
`product-action` bridge mode adds the same strict optional field. An old bridge
rejects the unfamiliar field before execution, rather than treating a new mode
as a generic helper. There is no stripped retry, fallback mode or new grant.

Legacy requests still receive exactly `{"status":"finished"}`. Opted-in runtime
and bridge responses are exactly `{"status":"finished","replyVersion":1}` with
optional `assistantText`. Only `final_response` from a completed, non-error,
non-interrupted, non-partial/non-truncated result is eligible. Missing/invalid
text is omitted, never truncated or fabricated. Text must be nonblank, at most
2,048 UTF-16 units / 4,096 UTF-8 bytes, with valid surrogate pairs and no controls
except tab/LF/CR. Objects, history, reasoning and tool fields are never projected.
Known callback/bridge credentials are rejected if present in text.

The backend returns optional `assistantReply:{version:1,text}` alongside the
existing owner/root/turn-bound receipt, or `replyUnavailable:true`. It accepts
text only from the claimed completed run while the current root still owns its
slot and has not expired/cancelled. Typed questions retain their original typed
authority and suppress prose. Effect outcome/expected/verified/targets and
continuation depend only on guards/journal/readback, never prose. A completed
host-read-only request with zero calls reports only `No actions performed.`;
an unfulfilled mutation with zero calls remains uncertain even if prose says Done.

Reply text exists only in disposable conversation text and native encrypted
history, never permanent intent/operation/effect records. The existing earlier
root/reference expiry (at most 24h) also applies to replies, including completed
roots whose original text was discarded. Server cancel/maintenance reclaim the
server copy; native transcript uses existing encrypted history/owner/TTL controls.
Native history uses one `reply:<turn>` identity plus a separate receipt event,
retains uncertainty claims, reserves room before send, and includes settled prose
only through the existing **untrusted** bounded reference mechanism.

Rollout requires paired candidate runtime + `assistant_reply.py` + launcher/model
policy + bridge, backend and new native capability support. Old clients keep the
legacy path; new native against old backend sends legacy bodies. Mixed new
backend/old bridge is a safe pre-execution refusal, not successful reply support.
Deployment/publication/restarts/install/signing remain separate gates.

## Parent prerequisites

- Reviewed candidate code and approved official runtime bootstrap on Hermes;
  authentication only through the existing model-policy/bootstrap seam.
- A **new, empty**, explicitly disposable PostgreSQL 17 database named
  `dcc_qa_*` at **127.0.0.1:18533**, synthetic-only login/role, public tables
  `planner_entities`, `planner_runs` only, and the existing empty singleton run.
  This runner performs no schema creation/migrations, cleanup or adoption.
- Port **127.0.0.1:18534** free for this runner's authenticated fixture/callback.
- `/root/.hermes/profiles/project-manager/cache/scratch` exists; the fixed consumed-budget marker and its `.1`/`.2`
  slot markers do **not** exist. The harness has no reset/replenishment path.
  Do not remove markers to rerun; interruption/failure consumes the allowance.
- No ambient `PG*`, `DATABASE_URL`, Node preload/extra-CA, Python path/home/startup,
  URL/host/proxy or provider endpoint/base-URL overrides. No broad
  `DCC_QA_RUNTIME_CAMPAIGN` variable.
  Existing provider authentication remains in the approved bootstrap, not new
  environment credentials. Do not run across NY midnight.

From repository root in the parent's approved isolated environment:

```sh
DCC_QA_RUNTIME_APPROVED=synthetic-loopback-model \
DCC_QA_NATURAL_REPLIES=consume-two-once \
DCC_QA_DATABASE=dcc_qa_natural_replies \
DCC_QA_PG_USER=dcc_qa \
backend/node_modules/.bin/tsx backend/test/acceptance/natural-replies.ts
```

The script exclusively creates/fsyncs the **entire consumed budget** at
`/root/.hermes/profiles/project-manager/cache/scratch/dcc-natural-replies-two-turn-v1.consumed` before bootstrap/transport.
Each bootstrapped invocation exclusively creates/fsyncs its fixed `.1` or `.2`
slot before `run_action`. At most **two agent invocations total**, even after a
crash or uncertain result. No retries, campaign options, model/destination
overrides or replenishment. Existing 90s / 8-iteration / 12-call / 4-write limits
remain; timeout/cancellation stops only this runner's child process group.

Turn 1 moves exactly three preseeded study-task IDs using bounded reference and
fresh reads. The runner checks exact dates, all non-date fields, the unrelated
task/project, three authoritative update receipts and explicit tool readback.
Turn 2 uses the genuine first reply as untrusted bounded reference for an
explanation, under the host read-only guard, and checks all domain/receipt rows
unchanged. Both must contain validated genuine final text. Only allowlisted
stages/counts/equality booleans/receipt results are printed; no raw text/prompts,
credentials, provider/driver diagnostics or evidence objects are logged. Failure
is failure, not permission to try a third conversation. Public TLS/live product
integration is not proved by this loopback acceptance.

## Offline/source checks (also parent-owned)

```sh
python3 -m unittest discover -s backend/deploy -p 'test_task_action_runtime.py'
python3 -m unittest discover -s backend/deploy -p 'test_task_action_qa_adapter.py'
backend/node_modules/.bin/tsx --test backend/test/mcp/assistant-reply.test.ts backend/test/mcp/contextual-conversation.test.ts backend/test/mcp/host-checklist.test.ts
backend/node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --esModuleInterop --skipLibCheck backend/test/mcp/assistant-reply.test.ts backend/test/acceptance/natural-replies.ts
npm run check:backend
npm --prefix frontend run check
```

Use the established empty signing-free JVM home, cached SDK35/JDK21/Gradle for
`:app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug`.
New JVM target: `HermesAssistantReplyTest`. Preserve and rerun all 24 dedicated-QA
native UI regressions; no new device test is added here. All checks above are
unrun by the source worker. Stubbed contracts do not prove actual model behavior.
