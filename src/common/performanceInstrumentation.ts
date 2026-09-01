import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance as nodePerformance } from "node:perf_hooks";
import { app, type ProcessMetric } from "electron";
import isDev from "electron-is-dev";

const REPORT_SCHEMA_VERSION = 1;
const SAMPLE_INTERVAL_MS = 5_000;
const MAX_RUNTIME_SNAPSHOTS = 720;

export type PerformanceMilestoneName =
    | "process-start"
    | "electron-ready"
    | "main-window-created"
    | "navigation-start"
    | "dom-ready"
    | "renderer-loaded"
    | "discord-renderer-ready"
    | "splash-end"
    | "first-visible-window";

type DetailValue = boolean | number | string | null;
type Details = Record<string, DetailValue>;

interface PerformanceMilestone {
    name: PerformanceMilestoneName;
    at: string;
    elapsedMs: number;
    details?: Details;
}

interface ProcessSnapshot {
    pid: number;
    type: ProcessMetric["type"];
    name?: string;
    serviceName?: string;
    cpu: {
        percent: number;
        cumulativeCpuUsage?: number;
    };
    memory: {
        workingSetSizeKb: number;
        peakWorkingSetSizeKb: number;
        privateBytesKb?: number;
    };
}

interface RuntimeSnapshot {
    at: string;
    elapsedMs: number;
    reason: string;
    processCount: number;
    cpu: {
        userMicros: number;
        systemMicros: number;
    };
    nodeMemory: NodeJS.MemoryUsage;
    processes: {
        main: ProcessSnapshot[];
        renderer: ProcessSnapshot[];
        gpu: ProcessSnapshot[];
        other: ProcessSnapshot[];
    };
}

export interface PerformanceInstrumentationConfiguration {
    performancePreset: string;
    mods: string[];
    flags: {
        switches: Record<string, string | boolean>;
        enableFeatures: string[];
        disableFeatures: string[];
        enableBlinkFeatures: string[];
        disableBlinkFeatures: string[];
    };
}

export interface PerformanceReport {
    schemaVersion: number;
    generatedAt: string;
    app: {
        name: string;
        version: string;
        packaged: boolean;
        platform: NodeJS.Platform;
        arch: string;
        osRelease: string;
        osVersion: string;
        versions: NodeJS.ProcessVersions;
    };
    configuration: PerformanceInstrumentationConfiguration & {
        enabled: boolean;
        commandLine: string[];
    };
    startup: {
        processStart: string;
        milestones: PerformanceMilestone[];
    };
    runtime: {
        sampleIntervalMs: number;
        snapshots: RuntimeSnapshot[];
    };
    reportPath?: string;
}

const processStartEpochMs = nodePerformance.timeOrigin;
const processStartIso = new Date(processStartEpochMs).toISOString();
const startedAt = () => new Date(processStartEpochMs + nodePerformance.now()).toISOString();
const elapsedMs = () => Math.round(nodePerformance.now() * 100) / 100;

function parseReportPath(): string | undefined {
    const argument = process.argv.find(
        (value) => value === "--performance-report" || value.startsWith("--performance-report="),
    );
    if (!argument || argument === "--performance-report") return undefined;
    const requestedPath = argument.slice("--performance-report=".length).trim();
    return requestedPath.length > 0 ? path.resolve(requestedPath) : undefined;
}

function isInstrumentationEnabled(): boolean {
    if (process.argv.includes("--no-performance-report")) return false;
    return (
        isDev ||
        process.argv.some((value) => value === "--performance-report" || value.startsWith("--performance-report=")) ||
        ["1", "true", "yes"].includes((process.env.TAJSCORD_PERFORMANCE ?? "").toLowerCase())
    );
}

function summarizeProcess(metric: ProcessMetric): ProcessSnapshot {
    return {
        pid: metric.pid,
        type: metric.type,
        ...(metric.name ? { name: metric.name } : {}),
        ...(metric.serviceName ? { serviceName: metric.serviceName } : {}),
        cpu: {
            percent: metric.cpu.percentCPUUsage,
            ...(metric.cpu.cumulativeCPUUsage === undefined
                ? {}
                : { cumulativeCpuUsage: metric.cpu.cumulativeCPUUsage }),
        },
        memory: {
            workingSetSizeKb: metric.memory.workingSetSize,
            peakWorkingSetSizeKb: metric.memory.peakWorkingSetSize,
            ...(metric.memory.privateBytes === undefined ? {} : { privateBytesKb: metric.memory.privateBytes }),
        },
    };
}

class PerformanceInstrumentation {
    readonly enabled = isInstrumentationEnabled();
    private readonly milestones: PerformanceMilestone[] = [
        { name: "process-start", at: processStartIso, elapsedMs: 0 },
    ];
    private readonly snapshots: RuntimeSnapshot[] = [];
    private configuration: PerformanceInstrumentationConfiguration = {
        performancePreset: "unknown",
        mods: [],
        flags: {
            switches: {},
            enableFeatures: [],
            disableFeatures: [],
            enableBlinkFeatures: [],
            disableBlinkFeatures: [],
        },
    };
    private interval: NodeJS.Timeout | undefined;
    private samplingStarted = false;
    private finalized = false;
    private reportPath: string | undefined;

    configure(configuration: PerformanceInstrumentationConfiguration): void {
        this.configuration = {
            performancePreset: configuration.performancePreset,
            mods: [...configuration.mods],
            flags: configuration.flags,
        };
    }

    mark(name: PerformanceMilestoneName, details?: Details): void {
        if (!this.enabled || this.finalized || this.milestones.some((milestone) => milestone.name === name)) return;
        const milestone: PerformanceMilestone = {
            name,
            at: startedAt(),
            elapsedMs: elapsedMs(),
            ...(details ? { details } : {}),
        };
        this.milestones.push(milestone);
        console.log(`[Performance] ${name} +${milestone.elapsedMs.toFixed(2)}ms`);
        if (this.samplingStarted) this.captureRuntimeSnapshot(`milestone:${name}`);
        this.writeReport();
    }

    startRuntimeSampling(): void {
        if (!this.enabled || this.interval) return;
        this.captureRuntimeSnapshot("electron-ready");
        this.samplingStarted = true;
        this.writeReport();
        this.interval = setInterval(() => this.captureRuntimeSnapshot("interval"), SAMPLE_INTERVAL_MS);
        this.interval.unref();

        const finalize = () => this.finalize();
        app.once("before-quit", finalize);
        app.once("will-quit", finalize);
        process.once("exit", finalize);
    }

    captureRuntimeSnapshot(reason: string): void {
        if (!this.enabled || this.finalized || this.snapshots.length >= MAX_RUNTIME_SNAPSHOTS) return;

        let metrics: ProcessMetric[] = [];
        try {
            metrics = app.getAppMetrics();
        } catch (error) {
            console.warn("[Performance] Could not capture Electron process metrics:", error);
        }

        const processes = metrics.map(summarizeProcess);
        const grouped = {
            main: processes.filter((process) => process.type === "Browser"),
            renderer: processes.filter((process) => process.type === "Tab"),
            gpu: processes.filter((process) => process.type === "GPU"),
            other: processes.filter((process) => !["Browser", "Tab", "GPU"].includes(process.type)),
        };
        const cpu = process.cpuUsage();
        this.snapshots.push({
            at: startedAt(),
            elapsedMs: elapsedMs(),
            reason,
            processCount: processes.length,
            cpu: { userMicros: cpu.user, systemMicros: cpu.system },
            nodeMemory: process.memoryUsage(),
            processes: grouped,
        });
        if (reason === "interval" && this.snapshots.length % 3 === 0) this.writeReport();
    }

    finalize(): void {
        if (!this.enabled || this.finalized) return;
        if (this.interval) clearInterval(this.interval);
        this.captureRuntimeSnapshot("final");
        this.finalized = true;
        this.writeReport();
    }

    private writeReport(): void {
        try {
            const report = this.createReport();
            const reportPath = this.resolveReportPath();
            mkdirSync(path.dirname(reportPath), { recursive: true });
            writeFileSync(reportPath, `${JSON.stringify({ ...report, reportPath }, null, 2)}\n`, "utf8");
            console.log(`[Performance] Wrote report to ${reportPath}`);
        } catch (error) {
            console.error("[Performance] Could not write report:", error);
        }
    }

    private resolveReportPath(): string {
        if (this.reportPath) return this.reportPath;
        const requestedPath = parseReportPath();
        if (requestedPath) {
            this.reportPath = requestedPath;
            return requestedPath;
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        this.reportPath = path.join(app.getPath("userData"), "performance", `startup-${timestamp}.json`);
        return this.reportPath;
    }

    private createReport(): PerformanceReport {
        return {
            schemaVersion: REPORT_SCHEMA_VERSION,
            generatedAt: new Date().toISOString(),
            app: {
                name: app.getName(),
                version: app.getVersion(),
                packaged: app.isPackaged,
                platform: process.platform,
                arch: process.arch,
                osRelease: os.release(),
                osVersion: os.version(),
                versions: process.versions,
            },
            configuration: {
                ...this.configuration,
                enabled: this.enabled,
                commandLine: process.argv.filter((value) => value.startsWith("--")),
            },
            startup: {
                processStart: processStartIso,
                milestones: this.milestones,
            },
            runtime: {
                sampleIntervalMs: SAMPLE_INTERVAL_MS,
                snapshots: this.snapshots,
            },
        };
    }
}

export const performanceInstrumentation = new PerformanceInstrumentation();
