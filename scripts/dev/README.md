# TajsCord development workflow

Use `pnpm dev` for the normal inner loop. It performs one application build,
starts Rolldown in watch mode, and launches Electron with the isolated
`TajsCord-dev` user-data profile.

- TypeScript/main and preload output changes restart Electron automatically.
- HTML/CSS/asset changes reload local TajsCord renderer windows when possible.
- Shelter plugins are rebuilt only when something under `src/shelter` changes.
- Ctrl+C stops Electron, Rolldown, and any plugin build child together.

Application arguments can be forwarded after `--`, for example:

```text
pnpm dev -- --bypass-setup
```

Use `pnpm start` (or `pnpm build`) when you need the full clean plugin and
application build path used for validation and packaging.
