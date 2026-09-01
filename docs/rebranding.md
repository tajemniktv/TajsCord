# TajsCord identity and compatibility

TajsCord's application identity is defined in `src/common/appIdentity.ts` and
is consumed by the Electron bootstrap, packaging configuration, updater, and
runtime diagnostics. This keeps the product name, application ID, repository,
release URLs, artifact prefix, and data-directory names in one place.

## User-data profiles

- Development runs use `%APPDATA%/TajsCord-dev` (or the platform equivalent).
- Packaged runs use `%APPDATA%/TajsCord` (or the platform equivalent).
- Development uses one stable `-dev` profile instead of branch/channel suffixes,
  so switching local branches does not multiply or mix profiles.
- Portable packages use a `tajs-cord-data` directory beside the executable.
- An existing `legcord-data` portable directory is selected as a compatibility
  fallback, with a warning; TajsCord never copies or merges it automatically.
- The old generic Electron profile is not migrated automatically because its
  ownership cannot be established safely.

The bootstrap configures these paths before importing `main.ts`, so modules
that cache `app.getPath("userData")` at import time all observe the same root.

## Deliberate compatibility identifiers

The `legcord://` internal protocol and `window.legcord` preload global remain
available because installed themes, plugins, and custom bundles use them. They
are compatibility namespaces, not the product identity, and are intentionally
not renamed in this migration. The same applies to serialized settings keys,
backup fields, plugin/section IDs, settings routes, CSS event IDs, custom-bundle
symbols, and DOM selectors containing `legcord`; changing those would break
existing user data or extensions without a migration benefit.

The pinned `arrpc` package remains sourced from its upstream
`Legcord/arrpc` repository as a third-party dependency. It is not an
application update endpoint; the updater is explicitly pinned to the TajsCord
repository above.
