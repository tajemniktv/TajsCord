import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { APP_IDENTITY, getDefaultUserDataDirectory } from "./common/appIdentity.js";

function isDirectory(candidatePath: string): boolean {
    try {
        return statSync(candidatePath).isDirectory();
    } catch {
        return false;
    }
}

function getPortableUserDataPath(): string | undefined {
    // Portable mode is a packaged-app convention. In development Electron's
    // executable lives in node_modules, so inspecting its directory would be
    // surprising and could accidentally select an unrelated folder.
    if (!app.isPackaged) return undefined;

    const executableDirectory = path.dirname(app.getPath("exe"));
    const portablePath = path.join(executableDirectory, APP_IDENTITY.dataDirectories.portable);
    if (existsSync(portablePath) && isDirectory(portablePath)) {
        return portablePath;
    }

    // Keep existing portable installations usable without silently copying or
    // merging their contents into a new profile.
    const legacyPortablePath = path.join(executableDirectory, APP_IDENTITY.dataDirectories.legacyPortable);
    if (existsSync(legacyPortablePath) && isDirectory(legacyPortablePath)) {
        console.warn(
            `[${APP_IDENTITY.productName}] Using legacy portable data directory "${APP_IDENTITY.dataDirectories.legacyPortable}". Rename it to "${APP_IDENTITY.dataDirectories.portable}" when convenient.`,
        );
        return legacyPortablePath;
    }

    return undefined;
}

/** Configure Electron before importing any module that reads an Electron path. */
export function configureApplicationIdentity(): string {
    app.setName(APP_IDENTITY.productName);
    app.setAppUserModelId(APP_IDENTITY.appUserModelId);

    const userDataPath =
        getPortableUserDataPath() ?? getDefaultUserDataDirectory(app.getPath("appData"), app.isPackaged);
    app.setPath("userData", userDataPath);

    if (!app.isPackaged) {
        console.log(`[${APP_IDENTITY.productName}] User data path: ${userDataPath}`);
    }
    return userDataPath;
}

configureApplicationIdentity();
await import("./main.js");
