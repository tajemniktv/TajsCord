import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import solid from "@rolldown-plugin/solid";
import esmShim from "@rollup/plugin-esm-shim";
import { defineConfig } from "rolldown";
import copy from "rollup-plugin-copy";

const electronExternals = ["electron", "node:fs", "node:path", "node:os", "node:url", "@vencord/venmic"];

function collectFiles(root: string): string[] {
    if (!existsSync(root)) return [];

    const files: string[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectFiles(fullPath));
        } else if (entry.isFile()) {
            files.push(fullPath);
        }
    }
    return files;
}

const copiedFilesWatch = {
    name: "watch-copied-files",
    buildStart(this: { addWatchFile: (id: string) => void }) {
        // rollup-plugin-copy copies these files at buildEnd but does not register
        // them with the watcher. Registering them keeps `rolldown --watch`
        // useful for HTML/CSS/asset-only edits as well as TypeScript changes.
        for (const file of [
            ...collectFiles(path.resolve("src")).filter(
                (candidate) => /\.(?:css|html|js)$/i.test(candidate) && !candidate.split(path.sep).includes("shelter"),
            ),
            ...collectFiles(path.resolve("assets")),
            path.resolve("package.json"),
            path.resolve("node_modules/@uwu/shelter-ui/compat.css"),
        ]) {
            if (statSync(file).isFile()) this.addWatchFile(file);
        }
    },
};

export default defineConfig([
    {
        input: "src/bootstrap.ts",
        output: {
            dir: "ts-out",
            format: "esm",
            sourcemap: true,
        },
        platform: "node",
        external: [
            ...electronExternals,
            "electron",
            "electron-is-dev",
            "electron-updater",
            "electron-context-menu",
            "arrpc",
            "path",
            "stream",
            "stream/promises",
        ],
        plugins: [
            copiedFilesWatch,
            esmShim(),
            copy({
                targets: [
                    { src: "src/**/**/*.html", dest: "ts-out/html/" },
                    { src: "src/**/**/*.css", dest: "ts-out/css/" },
                    { src: "src/setup/setup.css", dest: "ts-out/html/" },
                    { src: "node_modules/@uwu/shelter-ui/compat.css", dest: "ts-out/html/" },
                    { src: "src/**/**/*.js", dest: "ts-out/js/" },
                    { src: "package.json", dest: "ts-out/" },
                    { src: "assets/**/**", dest: "ts-out/assets/" },
                    // Monaco AMD tree for the offline Quick CSS editor (next to editor.html)
                    { src: "node_modules/monaco-editor/min/vs/**/*", dest: "ts-out/html/monaco/vs" },
                ],
            }),
        ],
    },
    {
        input: "src/rpc.ts",
        output: {
            dir: "ts-out",
            format: "esm",
            sourcemap: true,
        },
        external: [...electronExternals, "arrpc", "node:worker_threads"],
        plugins: [esmShim()],
    },
    {
        input: "src/discord/preload/preload.mts",
        output: {
            dir: "ts-out/discord",
            entryFileNames: "[name].mjs",
            format: "esm",
            sourcemap: true,
        },
        external: electronExternals,
    },
    {
        input: "src/splash/preload.mts",
        output: {
            dir: "ts-out/splash",
            format: "esm",
            entryFileNames: "[name].mjs",
            sourcemap: true,
        },
        external: electronExternals,
    },
    {
        input: "src/setup/preload.mts",
        output: {
            dir: "ts-out/setup",
            format: "esm",
            entryFileNames: "[name].mjs",
            sourcemap: true,
        },
        external: electronExternals,
    },
    {
        input: "src/cssEditor/preload.mts",
        output: {
            dir: "ts-out/cssEditor",
            format: "esm",
            entryFileNames: "[name].mjs",
            sourcemap: true,
        },
        external: electronExternals,
    },
    {
        input: "src/setup/setup.tsx",
        output: {
            dir: "ts-out/html",
            format: "esm",
            entryFileNames: "[name].js",
            sourcemap: true,
        },
        platform: "browser",
        external: [...electronExternals],
        plugins: [solid()],
    },
]);
