# Integration test

Run from the plugin directory:

```powershell
node --test
```

The automated integration test is `test/engine.test.js`. It creates:

- a local bare Git repository;
- a disposable profile with one registry plugin, one local `link:` plugin and one skill;
- a Profile Sync engine with a fixed MachineGuid.

It then snapshots the profile and reads the device back from the data repository.

To verify a real apply, use a **disposable DSH profile**, never `desktop`:

1. Copy a minimal profile to a temporary directory.
2. Point **`DSH_HOME`** (not only `DSH_PROFILE_DIR`) and the data repository at temporary paths. The engine derives the profile from `DSH_HOME/profiles/<profile>` and refuses any other location.
3. Sync device A.
4. Sync device B with a different MachineGuid.
5. Apply A's snapshot to B.
6. Assert package.json, bundles and skills.
7. Force an install failure and assert rollback.
