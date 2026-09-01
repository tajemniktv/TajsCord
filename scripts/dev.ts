import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, type FSWatcher, mkdirSync, readdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const shelterSource = path.join(repoRoot, "src", "shelter");
const pluginOutput = path.join(repoRoot, "ts-out", "plugins");
const pluginStatePath = path.join(repoRoot, ".cache", "tajscord-dev", "plugins.json");
const electronEntry = path.join(repoRoot, "ts-out", "bootstrap.js");
const isWindows = process.platform === "win32";
const executableSuffix = isWindows ? ".cmd" : "";

const forwardedArguments = process.argv.slice(2);
if (forwardedArguments[0] === "--") forwardedArguments.shift();
const electronArguments = ["--trace-warnings", "--ozone-platform-hint=auto", electronEntry, ...forwardedArguments];

let shuttingDown = false;
let shutdownPromise: Promise<void> | undefined;
let finishRuntime: (() => void) | undefined;
let electronProcess: ChildProcess | undefined;
let rolldownProcess: ChildProcess | undefined;
let pluginBuildTimer: NodeJS.Timeout | undefined;
let restartTimer: NodeJS.Timeout | undefined;
let restartInProgress = false;
let restartPending = false;
let outputEventsEnabled = false;
let outputEventsTimer: NodeJS.Timeout | undefined;
const watchers: FSWatcher[] = [];
const runningChildren = new Set<ChildProcess>();

function commandPath(command: string): string {
    return `${command}${executableSuffix}`;
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function collectFiles(root: string): string[] {
    if (!existsSync(root)) return [];

    const files: string[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) files.push(...collectFiles(fullPath));
        else if (entry.isFile()) files.push(fullPath);
    }
    return files;
}

function sourceFingerprint(): string {
    const hash = createHash("sha256");
    for (const file of collectFiles(shelterSource).sort()) {
        hash.update(path.relative(repoRoot, file).replaceAll(path.sep, "/"));
        hash.update("\0");
        hash.update(readFileSync(file));
        hash.update("\0");
    }
    return hash.digest("hex");
}

function readPluginFingerprint(): string | undefined {
    try {
        const state = JSON.parse(readFileSync(pluginStatePath, "utf8")) as { sourceFingerprint?: unknown };
        return typeof state.sourceFingerprint === "string" ? state.sourceFingerprint : undefined;
    } catch {
        return undefined;
    }
}

function writePluginFingerprint(fingerprint: string): void {
    mkdirSync(path.dirname(pluginStatePath), { recursive: true });
    writeFileSync(pluginStatePath, `${JSON.stringify({ sourceFingerprint: fingerprint }, null, 4)}\n`, "utf8");
}

function pluginsNeedBuild(): boolean {
    return (
        !existsSync(pluginOutput) ||
        collectFiles(pluginOutput).length === 0 ||
        readPluginFingerprint() !== sourceFingerprint()
    );
}

function prefixOutput(stream: NodeJS.ReadableStream | null, label: string): void {
    if (!stream) return;
    let pending = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
        pending += chunk;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) {
            if (line.length > 0) console.log(`[${label}] ${line}`);
        }
    });
    stream.on("end", () => {
        if (pending.length > 0) console.log(`[${label}] ${pending}`);
    });
}

function spawnLogged(command: string, args: string[], label: string, environment?: NodeJS.ProcessEnv): ChildProcess {
    const options = {
        cwd: repoRoot,
        env: environment ?? process.env,
        detached: !isWindows,
        shell: isWindows,
        stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
        windowsHide: true,
    };
    // Windows exposes local package binaries as .cmd shims. Node requires a
    // shell to execute those shims, and emits DEP0190 for the intentional use.
    const previousNoDeprecation = process.noDeprecation;
    if (isWindows) process.noDeprecation = true;
    let child: ChildProcess;
    try {
        child = spawn(commandPath(command), args, options);
    } finally {
        process.noDeprecation = previousNoDeprecation;
    }
    runningChildren.add(child);
    prefixOutput(child.stdout, label);
    prefixOutput(child.stderr, label);
    child.once("close", () => runningChildren.delete(child));
    child.once("error", (error) => console.error(`[${label}] ${formatError(error)}`));
    return child;
}

function runCommand(command: string, args: string[], label: string, environment?: NodeJS.ProcessEnv): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawnLogged(command, args, label, environment);
        child.once("error", reject);
        child.once("close", (code, signal) => {
            if (code === 0) resolve();
            else
                reject(new Error(`${label} exited with ${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}.`));
        });
    });
}

function waitForOutput(child: ChildProcess, marker: RegExp): Promise<void> {
    const stdout = child.stdout;
    if (!stdout) return Promise.resolve();

    return new Promise((resolve, reject) => {
        let output = "";
        let ready = false;
        let quietTimer: NodeJS.Timeout | undefined;
        const onData = (chunk: string | Buffer) => {
            output += String(chunk);
            if (marker.test(output)) {
                ready = true;
            }
            if (ready) {
                if (quietTimer) clearTimeout(quietTimer);
                quietTimer = setTimeout(() => {
                    cleanup();
                    resolve();
                }, 2000);
            }
        };
        const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
            cleanup();
            reject(
                new Error(
                    `watch exited before becoming ready (${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}).`,
                ),
            );
        };
        const cleanup = () => {
            stdout.off("data", onData);
            child.off("close", onClose);
            if (quietTimer) clearTimeout(quietTimer);
        };

        stdout.on("data", onData);
        child.once("close", onClose);
    });
}

function terminateChild(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();

    return new Promise((resolve) => {
        let settled = false;
        let timeout: NodeJS.Timeout | undefined;
        const finish = () => {
            if (settled) return;
            settled = true;
            if (timeout) clearTimeout(timeout);
            resolve();
        };

        child.once("close", finish);
        if (isWindows && child.pid) {
            const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
                stdio: "ignore",
                windowsHide: true,
            });
            killer.once("close", () => {
                if (!settled && child.exitCode === null) child.kill();
            });
            killer.once("error", () => child.kill());
        } else if (child.pid) {
            try {
                process.kill(-child.pid, "SIGTERM");
            } catch {
                child.kill("SIGTERM");
            }
        } else {
            child.kill("SIGTERM");
        }

        timeout = setTimeout(() => {
            if (settled) return;
            try {
                if (!isWindows && child.pid) process.kill(-child.pid, "SIGKILL");
                else child.kill("SIGKILL");
            } catch {
                // The process may have exited between the graceful and forced termination attempts.
            }
            finish();
        }, 5000);
    });
}

async function ensurePluginsBuilt(): Promise<void> {
    const fingerprint = sourceFingerprint();
    if (!pluginsNeedBuild()) {
        console.log("[dev] Shelter/plugin output is up to date; skipping plugin build.");
        return;
    }

    console.log("[dev] Shelter/plugin source changed or output is missing; building plugins.");
    await runCommand("pnpm", ["run", "build:plugins"], "plugins");
    writePluginFingerprint(fingerprint);
}

function launchElectron(): void {
    const environment = { ...process.env, TAJSCORD_DEV: "1" };
    electronProcess = spawnLogged("electron", electronArguments, "electron", environment);
    electronProcess.once("close", (code, signal) => {
        if (shuttingDown || restartInProgress) return;
        const result = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
        console.error(`[dev] Electron exited unexpectedly (${result}). Stopping watchers.`);
        void requestShutdown(signal ? 1 : (code ?? 0));
    });
    console.log("[dev] Electron started with the isolated TajsCord-dev profile.");
}

async function restartElectron(reason: string): Promise<void> {
    if (shuttingDown) return;
    if (restartInProgress) {
        restartPending = true;
        return;
    }

    restartInProgress = true;
    console.log(`[dev] ${reason}; restarting Electron.`);
    const current = electronProcess;
    if (current) await terminateChild(current);
    electronProcess = undefined;
    if (!shuttingDown) launchElectron();
    restartInProgress = false;

    if (restartPending && !shuttingDown) {
        restartPending = false;
        await restartElectron("Additional output changed during restart");
    }
}

function queueElectronRestart(reason: string): void {
    if (shuttingDown) return;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
        restartTimer = undefined;
        void restartElectron(reason).catch((error) => {
            console.error(`[dev] Electron restart failed: ${formatError(error)}`);
            void requestShutdown(1);
        });
    }, 250);
}

function queuePluginBuild(): void {
    if (shuttingDown) return;
    if (pluginBuildTimer) clearTimeout(pluginBuildTimer);
    pluginBuildTimer = setTimeout(() => {
        pluginBuildTimer = undefined;
        void rebuildPlugins();
    }, 250);
}

let pluginBuildPromise: Promise<void> | undefined;
let pluginBuildQueued = false;
async function rebuildPlugins(): Promise<void> {
    if (shuttingDown) return;
    if (pluginBuildPromise) {
        pluginBuildQueued = true;
        return;
    }

    pluginBuildPromise = (async () => {
        try {
            const fingerprint = sourceFingerprint();
            await runCommand("pnpm", ["run", "build:plugins"], "plugins");
            writePluginFingerprint(fingerprint);
            queueElectronRestart("Shelter/plugin output changed");
        } catch (error) {
            console.error(`[dev] Plugin rebuild failed; keeping the previous output: ${formatError(error)}`);
        } finally {
            pluginBuildPromise = undefined;
            if (pluginBuildQueued) {
                pluginBuildQueued = false;
                queuePluginBuild();
            }
        }
    })();
    await pluginBuildPromise;
}

function startWatchers(): void {
    outputEventsEnabled = false;
    outputEventsTimer = setTimeout(() => {
        outputEventsEnabled = true;
    }, 2000);

    const outputDirectory = path.join(repoRoot, "ts-out");
    if (existsSync(outputDirectory)) {
        try {
            watchers.push(
                watch(outputDirectory, { recursive: true }, (_event, filename) => {
                    if (!filename || shuttingDown || !outputEventsEnabled) return;
                    const relative = String(filename).replaceAll("\\", "/");
                    if (relative.endsWith(".map")) return;
                    if (/^(?:[^/]+|(?:discord|splash|setup|cssEditor)\/.*)\.(?:js|mjs)$/.test(relative)) {
                        queueElectronRestart(`Application output changed (${relative})`);
                    }
                }),
            );
        } catch (error) {
            console.warn(
                `[dev] Could not watch application output; automatic restarts are disabled: ${formatError(error)}`,
            );
        }
    }

    if (existsSync(shelterSource)) {
        try {
            watchers.push(
                watch(shelterSource, { recursive: true }, (_event, filename) => {
                    if (!filename || shuttingDown) return;
                    if (!String(filename).endsWith(".map")) queuePluginBuild();
                }),
            );
        } catch (error) {
            console.warn(
                `[dev] Could not watch Shelter sources; automatic plugin rebuilds are disabled: ${formatError(error)}`,
            );
        }
    }

    const packageFile = path.join(repoRoot, "package.json");
    try {
        watchers.push(
            watch(packageFile, () => {
                if (!shuttingDown) queueElectronRestart("package.json changed");
            }),
        );
    } catch (error) {
        console.warn(`[dev] Could not watch package.json: ${formatError(error)}`);
    }
}

function stopWatchers(): void {
    if (pluginBuildTimer) clearTimeout(pluginBuildTimer);
    if (restartTimer) clearTimeout(restartTimer);
    if (outputEventsTimer) clearTimeout(outputEventsTimer);
    outputEventsTimer = undefined;
    outputEventsEnabled = false;
    for (const watcher of watchers) watcher.close();
    watchers.length = 0;
}

async function requestShutdown(exitCode: number): Promise<void> {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    process.exitCode = exitCode;
    stopWatchers();
    shutdownPromise = (async () => {
        await Promise.all([...runningChildren].map((child) => terminateChild(child)));
        finishRuntime?.();
    })();
    await shutdownPromise;
}

function printHelp(): void {
    console.log(`TajsCord development workflow

  pnpm dev                     Build incrementally and restart Electron on code changes.
  pnpm dev -- --bypass-setup   Forward an Electron/application argument.

Shelter plugins are rebuilt only when src/shelter changes. Ctrl+C stops Electron,
Rolldown, and plugin build children together.`);
}

async function run(): Promise<void> {
    if (process.argv.slice(2).includes("--help")) {
        printHelp();
        return;
    }

    await ensurePluginsBuilt();
    console.log("[dev] Performing the initial application build.");
    await runCommand("rolldown", ["-c", "rolldown.config.ts"], "build");

    rolldownProcess = spawnLogged("rolldown", ["-c", "rolldown.config.ts", "--watch"], "watch");
    rolldownProcess.once("close", (code, signal) => {
        if (shuttingDown) return;
        const result = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
        console.error(`[dev] Rolldown watcher exited (${result}). Stopping Electron.`);
        void requestShutdown(1);
    });

    await waitForOutput(rolldownProcess, /Rebuilt ts-out[\\/]html in/);
    startWatchers();
    const runtimeFinished = new Promise<void>((resolve) => {
        finishRuntime = resolve;
    });
    launchElectron();
    await runtimeFinished;
}

process.once("SIGINT", () => void requestShutdown(0));
process.once("SIGTERM", () => void requestShutdown(0));

try {
    await run();
} catch (error) {
    console.error(`[dev] Startup failed: ${formatError(error)}`);
    await requestShutdown(1);
}
