import { platform } from "node:os";
import type { AllPublishOptions } from "builder-util-runtime";
import { AppImageUpdater, DebUpdater, MacUpdater } from "electron-updater";
import { APP_IDENTITY } from "./common/appIdentity.js";

const updateProvider: AllPublishOptions = APP_IDENTITY.updateProvider;

if (platform() === "darwin") {
    const autoUpdater = new MacUpdater(updateProvider);
    autoUpdater.checkForUpdatesAndNotify();
}

if (platform() === "linux") {
    const appimage = new AppImageUpdater(updateProvider);
    const deb = new DebUpdater(updateProvider);

    deb.on("update-downloaded", (_e) => {
        deb.quitAndInstall();
    });
    appimage.on("update-downloaded", (_e) => {
        appimage.quitAndInstall();
    });

    deb.checkForUpdatesAndNotify();
    appimage.checkForUpdatesAndNotify();
}
