import { contextBridge, ipcRenderer } from "electron";
import { APP_IDENTITY } from "../common/appIdentity.js";

contextBridge.exposeInMainWorld("internal", {
    restart: () => ipcRenderer.send("restart"),
    version: ipcRenderer.sendSync("get-app-version", "app-version") as string,
    latestReleaseApiUrl: APP_IDENTITY.latestReleaseApiUrl,
    isDev: ipcRenderer.sendSync("splash-isDev") as string,
    isMicrosoftStore: ipcRenderer.sendSync("splash-isMicrosoftStore") as string,
    mods: ipcRenderer.sendSync("splash-clientmod") as string,
    getLang: (toGet: string) =>
        ipcRenderer.invoke("getLang", toGet).then((result: string) => {
            return result;
        }),
    splashEnd: () => ipcRenderer.send("splashEnd"),
});
