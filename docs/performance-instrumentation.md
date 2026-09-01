# Performance instrumentation

TajsCord records startup milestones and lightweight runtime resource samples in
development runs. The instrumentation is disabled in packaged releases unless
it is explicitly enabled.

## Enable a report

- Development: run TajsCord normally. Instrumentation is enabled automatically.
- Packaged or opt-in runs: pass `--performance-report` or set
  `TAJSCORD_PERFORMANCE=1`.
- To write to a specific location, use
  `--performance-report=C:\path\to\report.json`.
- `--no-performance-report` disables instrumentation, including in development.

Without an explicit path, reports are written to the app's user-data directory
under `performance/startup-<timestamp>.json`. The path is also printed as a
`[Performance]` log line when the report is written.

## Report contents

The JSON report contains:

- observable startup milestones (process start, Electron ready, window creation,
  navigation start, DOM ready, renderer load, Discord mount, splash end, and
  first visible window), each with an ISO timestamp and elapsed milliseconds;
- host platform/architecture plus Electron, Chromium, Node, and V8 version information;
- the selected performance preset, enabled mod stack, tracked Chromium switches
  and feature lists, and command-line switches;
- runtime snapshots every five seconds, including process count, grouped main/
  renderer/GPU metrics, CPU usage, and Node memory usage.

Snapshots are capped at 720 entries (one hour) so an unattended development run
cannot grow the report without bound. Sampling uses Electron's existing process
metrics API and stops when the app quits.
