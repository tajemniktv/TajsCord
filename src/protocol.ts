import path from "node:path";
import Url from "node:url";
import { app, net, protocol } from "electron";
import { APP_IDENTITY } from "./common/appIdentity.js";

protocol.registerSchemesAsPrivileged([
    {
        scheme: APP_IDENTITY.compatibility.protocolScheme,
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            bypassCSP: true,
            stream: true,
        },
    },
]);

void app.whenReady().then(() => {
    // `legcord://` is retained as a compatibility-sensitive internal protocol.
    protocol.handle(APP_IDENTITY.compatibility.protocolScheme, (req) => {
        if (req.url.startsWith(`${APP_IDENTITY.compatibility.protocolScheme}://plugins/`)) {
            const url = req.url
                .replace(`${APP_IDENTITY.compatibility.protocolScheme}://plugins/`, "")
                .split("/");
            const filePath = path.join(import.meta.dirname, "plugins", `/${url[0]}/${url[1]}`);
            if (filePath.includes("..")) {
                return new Response("bad", {
                    status: 400,
                    headers: { "content-type": "text/html" },
                });
            }
            return net.fetch(Url.pathToFileURL(filePath).toString());
        } else if (req.url.startsWith(`${APP_IDENTITY.compatibility.protocolScheme}://html/`)) {
            const file = req.url.replace(`${APP_IDENTITY.compatibility.protocolScheme}://html/`, "");
            const filePath = path.join(import.meta.dirname, "html", `${file}`);
            if (filePath.includes("..")) {
                return new Response("bad", {
                    status: 400,
                    headers: { "content-type": "text/html" },
                });
            }
            return net.fetch(Url.pathToFileURL(filePath).toString());
        } else if (req.url.startsWith(`${APP_IDENTITY.compatibility.protocolScheme}://js/`)) {
            const file = req.url.replace(`${APP_IDENTITY.compatibility.protocolScheme}://js/`, "");
            const filePath = path.join(import.meta.dirname, "js", `${file}`);
            if (filePath.includes("..")) {
                return new Response("bad", {
                    status: 400,
                    headers: { "content-type": "text/html" },
                });
            }
            return net.fetch(Url.pathToFileURL(filePath).toString());
        } else if (req.url.startsWith(`${APP_IDENTITY.compatibility.protocolScheme}://assets/`)) {
            const file = req.url.replace(`${APP_IDENTITY.compatibility.protocolScheme}://assets/`, "");
            const filePath = path.join(import.meta.dirname, "assets", "app", `${file}`);
            if (filePath.includes("..")) {
                return new Response("bad", {
                    status: 400,
                    headers: { "content-type": "text/html" },
                });
            }
            return net.fetch(Url.pathToFileURL(filePath).toString());
        } else if (req.url.startsWith(`${APP_IDENTITY.compatibility.protocolScheme}://css/`)) {
            const file = req.url.replace(`${APP_IDENTITY.compatibility.protocolScheme}://css/`, "");
            const filePath = path.join(import.meta.dirname, "css", `${file}`);
            if (filePath.includes("..")) {
                return new Response("bad", {
                    status: 400,
                    headers: { "content-type": "text/html" },
                });
            }
            return net.fetch(Url.pathToFileURL(filePath).toString());
        } else if (req.url.startsWith(`${APP_IDENTITY.compatibility.protocolScheme}://local/`)) {
            const file = req.url.replace(`${APP_IDENTITY.compatibility.protocolScheme}://local/`, "");
            const userDataPath = path.join(app.getPath("userData"), "userAssets");
            const filePath = path.normalize(path.join(userDataPath, `${file}`));
            if (!filePath.startsWith(userDataPath)) {
                return new Response("bad", {
                    status: 400,
                    headers: { "content-type": "text/html" },
                });
            }
            return net.fetch(Url.pathToFileURL(filePath).toString());
        }
        return new Response("bad", {
            status: 400,
            headers: { "content-type": "text/html" },
        });
    });
});
