# Dedicated DCC Hermes profile

DCC conversation requests (`chatVersion: 1`) use the fixed named profile
`/root/.hermes/profiles/dcc`. Web and Android use that same server profile for
this single-user DCC workspace. Legacy task/parser/background requests keep the
existing daymark-curator profile. This is not multi-account memory isolation.

The conversation agent loads only this profile's SOUL.md and the built-in
MEMORY.md/USER.md store. It exposes DCC MCP tools plus Hermes's built-in `memory`
tool; exact schema/scope checks still reject all other tools. `skip_memory=True`
intentionally disables external memory providers; requesting the `memory`
toolset initializes Hermes's built-in file store. Shell, arbitrary file tools,
skills, session search, background review and automatic jobs remain disabled.

The model can save durable preferences and lessons, inspect the memories loaded
for its request, and replace/remove entries when the user corrects or forgets
something. Every write must return success before Hermes claims it remembered.
Memories are curated, bounded notes, not a complete action audit or transcript.
Current DCC records and durable operation receipts remain authoritative. Existing
recent-chat limits and 24-hour transcript expiry remain in place. Failed,
partial and uncertain replies now remain quoted context with status caveats;
including them does not settle a receipt or authorize replay.

## One-time setup on Hermes

Stage `setup_dcc_profile.py`, `dcc_profile.py` and this directory beside one
another, then explicitly run `python3 setup_dcc_profile.py`. The operator must
approve this host change. It uses the official fresh-profile command with
`--no-skills --no-alias`, preserves the initial official seed files, writes the
source-owned identity/configuration and starts empty memory files. It does not
clone credentials, personal facts, chat history, integrations or another
profile's memories. Rerunning preserves learned memories and identity files.
An existing unmanaged `dcc` profile is refused rather than overwritten.

Hermes named profiles support the runtime's existing global-root authentication
fallback. Setup does not copy, read or change authentication files. Before
production activation, verify the intended provider is available for this
profile without exposing credentials; authentication is not established by
source or synthetic-memory tests.

## Release and verification

Ship `dcc_profile.py` alongside `task_action_runtime.py` and
`task_action_launcher.py`. Deploy the bridge change and web/backend artifacts
together after explicit approval. Existing installed Android clients need an
updated APK for the local continuity fix. Profile creation alone does not
activate these source changes in the running bridge. Back up both the app and
bridge release artifacts before activation. Rolling source back must preserve
the new profile and learned memories.

Offline local checks:

```
python -m unittest discover -s backend/deploy -p 'test_dcc_profile.py'
python -m unittest discover -s backend/deploy -p 'test_task_action_runtime.py'
python -m unittest discover -s backend/deploy -p 'test_task_action_launcher.py'
```

Explicit installed-runtime acceptance on Hermes from a staged source tree:

```
python3 backend/test/acceptance/dcc-memory-runtime.py
```

That acceptance uses two temporary named-profile directories under the real
Hermes profiles root so the existing installed dependency environment is reused.
It exercises the real memory tool across separate processes: remember, reload,
correct, isolate another profile, forget, reload empty. It invokes no model,
reads no credentials and blocks child network connections. It does not modify
DCC's actual memories. Never use an arbitrary temporary HERMES_HOME: Hermes may
try to provision a separate dependency environment for it.
