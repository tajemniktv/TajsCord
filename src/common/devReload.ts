import { existsSync, type FSWatcher, watch } from "node:fs";
import path from "node:path";
import { app, BrowserWindow } from "electron";
import { APP_IDENTITY } from "./appIdentity.js";

const DEV_ENVIRONMENT = "1";
const RENDERER_DIRECTORIES = ["html", "css", "js", "assets"];

let watchers: FSWatcher[] = [];
let reloadTimer: NodeJS.Timeout | undefined;

function isLocalRenderer(window: BrowserWindow): boolean {
    try {
        const url = window.webContents.getURL();
        return url.startsWith(`${APP_IDENTITY.compatibility.protocolScheme}://html/`) || url.startsWith("file://");
    } catch {
        return false;
    }
}

function reloadLocalRenderers(changedFile: string): void {
    const windows = BrowserWindow.getAllWindows().filter((window) => isLocalRenderer(window) && !window.isDestroyed());
    if (windows.length === 0) return;

    console.log(`[dev] Renderer asset changed (${changedFile}); reloading ${windows.length} local window(s).`);
    for (const window of windows) {
        window.webContents.reload();
    }
}

function queueReload(changedFile: string): void {
    if (changedFile.endsWith(".map")) return;
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
        reloadTimer = undefined;
        reloadLocalRenderers(changedFile);
    }, 150);
}

function stopWatcher(): void {
    if (reloadTimer) {
        clearTimeout(reloadTimer);
        reloadTimer = undefined;
    }
    for (const watcher of watchers) watcher.close();
    watchers = [];
}

/** Watch copied renderer assets during `pnpm dev` and reload local windows. */
export function startDevRendererReloadWatcher(): void {
    if (process.env.TAJSCORD_DEV !== DEV_ENVIRONMENT) return;

    const outputDirectory = import.meta.dirname;
    for (const directory of RENDERER_DIRECTORIES) {
        const fullPath = path.join(outputDirectory, directory);
        if (!existsSync(fullPath)) continue;

        try {
            watchers.push(
                watch(fullPath, { recursive: true }, (_event, filename) => {
                    queueReload(filename ? String(filename) : directory);
                }),
            );
        } catch (error) {
            console.warn(`[dev] Could not watch renderer directory ${fullPath}:`, error);
        }
    }

    if (watchers.length > 0) {
        app.once("before-quit", stopWatcher);
        console.log(`[dev] Watching renderer assets under ${outputDirectory}.`);
    }
}
