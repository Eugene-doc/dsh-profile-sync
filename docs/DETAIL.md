# Profile Sync — internals

## Data layout

```text
profiles/<profileName>/devices/<deviceId>/
  snapshot.json
  package.json
  pnpm-lock.yaml
  local-plugins/*.tgz
  skills/*.md
```

The data repository is private. It contains no settings or credentials.

## Identity

`deviceId` is derived from `SHA256(Windows MachineGuid + profileName)`. Restoring the
same profile on the same machine keeps the identity. A different machine gets a
different id.

## Apply pipeline

1. Validate profile name, DSH major version, archive paths and checksums.
2. Copy archives to `~/.dsh/profile-sync/archives/<sha256>.tgz`.
3. Back up `package.json`, `pnpm-lock.yaml`, bundles and skills.
4. Install/update packages with `dsh plugin --profile <profile> add`.
5. Merge bundles without removing local-only entries.
6. Apply skills relative to the stored base.
7. On failure restore files and run `dsh plugin install --frozen-lockfile`.

## Deliberate exclusions

- `cordis.patch.yml` and UI settings;
- credentials and provider keys;
- sessions, workspaces and attachments;
- Chat Sync relay and state;
- `node_modules`.
