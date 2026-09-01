/**
 * Canonical application identity and external links.
 *
 * Keep compatibility-sensitive values (the `legcord` protocol and renderer
 * global) explicit here instead of scattering them through the application.
 */
export const APP_IDENTITY = {
    productName: "TajsCord",
    packageName: "tajscord",
    executableName: "tajs-cord",
    appId: "app.tajscord.TajsCord",
    appUserModelId: "app.tajscord.TajsCord",
    repository: {
        owner: "tajemniktv",
        name: "TajsCord",
        url: "https://github.com/tajemniktv/TajsCord",
    },
    homepageUrl: "https://github.com/tajemniktv/TajsCord#readme",
    issuesUrl: "https://github.com/tajemniktv/TajsCord/issues",
    releasesUrl: "https://github.com/tajemniktv/TajsCord/releases",
    rawContentBaseUrl: "https://raw.githubusercontent.com/tajemniktv/TajsCord/dev",
    latestReleaseApiUrl: "https://api.github.com/repos/tajemniktv/TajsCord/releases/latest",
    updateProvider: {
        provider: "github" as const,
        owner: "tajemniktv",
        repo: "TajsCord",
    },
    // electron-builder expands these placeholders when it names release artifacts.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder macro placeholders
    artifactName: "TajsCord-${version}-${os}-${arch}.${ext}",
    packaging: {
        appxApplicationId: "TajsCord",
        appxIdentityName: "TajsCord.TajsCord",
        linuxStartupWmClass: "tajs-cord",
        dbusAddress: "/app/tajscord/TajsCord",
    },
    dataDirectories: {
        development: "TajsCord-dev",
        release: "TajsCord",
        portable: "tajs-cord-data",
        legacyPortable: "legcord-data",
    },
    temporaryDirectories: {
        touchbarGuilds: "tajsCordGuilds",
    },
    compatibility: {
        protocolScheme: "legcord",
        rendererGlobal: "legcord",
    },
} as const;

export type AppIdentity = typeof APP_IDENTITY;

export function getDefaultUserDataDirectory(appDataPath: string, isPackaged: boolean): string {
    const base = appDataPath.replace(/[\\/]$/, "");
    return `${base}/${isPackaged ? APP_IDENTITY.dataDirectories.release : APP_IDENTITY.dataDirectories.development}`;
}
