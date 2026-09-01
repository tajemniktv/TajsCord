# TajsCord Clipboard Fallback Plugin

Fixes Discord in-page copy actions in TajsCord, including:

- Copy User ID
- Copy Message ID
- Copy Message Link
- Other Discord menu actions that call `navigator.clipboard.writeText(...)`

## Why this exists

In affected TajsCord/Electron environments, Discord's web UI calls:

```js
navigator.clipboard.writeText(text)
```

but Chromium rejects it, commonly with errors like:

```text
NotAllowedError: Failed to execute 'writeText' on 'Clipboard': Document is not focused.
```

or TajsCord logs:

```text
Unable to determine render window for element [object HTMLDocument]
```

This plugin patches `navigator.clipboard.writeText` in the Discord page and falls back to a selection-based `document.execCommand("copy")` copy path.

## Known limitation

TajsCord's native **Copy Image** context-menu action does not go through `navigator.clipboard.writeText` or `navigator.clipboard.write` in the page. It is handled by Electron's main-process context menu (`webContents.copyImageAt(...)`), so a renderer/custom-bundle plugin cannot reliably fix image copying. That needs a TajsCord main-process fix or a filesystem plugin with main/preload access on newer TajsCord versions.

## Install on TajsCord versions with filesystem plugins

1. Open the TajsCord plugins folder:

   ```text
   ~/Library/Application Support/TajsCord/plugins
   ```

2. Create this folder:

   ```text
   clipboard-fallback
   ```

3. Copy these files into it:

   ```text
   manifest.json
   renderer.js
   ```

4. Restart TajsCord.
5. Enable **Clipboard Fallback** in TajsCord's plugin settings.

## Older TajsCord workaround: custom bundle

If your TajsCord version does not have filesystem plugins yet, copy `custom-bundle.js` into:

```text
~/Library/Application Support/TajsCord/custom.js
```

Do **not** use `renderer.js` as `custom.js`; `renderer.js` is the filesystem-plugin entry and expects TajsCord's plugin loader to provide `module.exports`.

and add `"custom"` to the `mods` array in:

```text
~/Library/Application Support/TajsCord/storage/settings.json
```

Example:

```json
"mods": ["equicord", "custom"]
```

Then restart TajsCord.
