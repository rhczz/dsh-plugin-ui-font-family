---
description: "A Font row in the dsh Web GUI General settings: four built-in presets, the fonts installed on the machine running dsh, and font files this deployment serves to every connected browser."
kind: "package-bundle"
---

# dsh-plugin-ui-font-family

English | [中文](README.zh.md)

## Summary

The Font row in General settings changes the font the interface and the conversation use. Users pick one of four presets, search the fonts installed on the machine running `dsh`, or upload font files that this deployment then serves to every connected browser. A choice applies immediately and persists. The package installs as a profile bundle: `dsh plugin --profile web add dsh-plugin-ui-font-family` adds the row, and removing the package removes it. Code blocks keep the harness's own monospace stack.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

### Install into a profile

```text
dsh plugin --profile web add dsh-plugin-ui-font-family
dsh plugin --profile web remove dsh-plugin-ui-font-family
```

The package declares `dsh.bundle.patch`, so `add` records it in the profile's `dsh.profile.bundles` and applies its layer, which inserts the `ui-font-family` row into the composition. Restart `dsh web` and the row appears in Settings → General, under Font size.

Installing from npm uses the published artifacts. Installing from a git ref or a source directory builds the package on that machine, and pnpm blocks the build script until the profile's `pnpm-workspace.yaml` allows it; follow the `allowBuilds` line the first attempt prints.

### What you get

- **The Font row** opens the picker: presets, uploaded fonts, and the fonts installed on the machine running `dsh`, with a search field and per-row previews drawn in the font each row names.
- **The management dialog** uploads fonts (`.ttf` `.otf` `.woff` `.woff2` `.ttc`, 20 MiB each by default), deletes them, and shows the directory uploaded files live in.
- **The installed stack** places the chosen families ahead of the stack the harness declares for itself, so text the chosen font cannot draw falls back to the harness's own faces. Code blocks keep the monospace stack.

![The Font row in General settings](assets/settings-font-row.png)

![The font picker](assets/font-picker.png)

### Configuration

Fields are optional and belong in the profile's own `$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
- id: ui-font-family
  config:
    defaultFamily:
      source: preset
      id: serif
```

| Field | Default | Meaning |
|---|---|---|
| `fontDir` | `$DSH_HOME/fonts` | Directory holding uploaded fonts. |
| `dshHome` | `$DSH_HOME`, then `~/.dsh` | Overrides the harness home this package resolves paths against. |
| `systemFontDirs` | `[]` | Extra directories to scan, after the platform's own. |
| `scanSystemFonts` | `true` | Scans the platform directories; the directories named in `systemFontDirs` are still scanned. |
| `maxUploadBytes` | `20971520` | Largest accepted upload, in bytes. The page refuses a larger file before reading it. |
| `defaultFamily` | `{ source: preset, id: default }` | Font used until a user chooses one, and what "restore default" returns to. |

`defaultFamily.source` is `preset`, `system`, or `upload`, with `id` naming a preset, a CSS family name, or a stored font. A user's own choice always wins over it. A value this package cannot act on — a non-integer limit, a preset id this build does not ship — fails at load rather than at first use.

### Where uploaded fonts are stored

`$DSH_HOME/fonts`, which is `~/.dsh/fonts` by default, next to `settings.yaml`. The management dialog shows the path in use.

- One directory to back up, migrate, or delete; nothing is stored in the browser.
- Copying a font file into it works without the settings page, and so does deleting one.
- A stored file is named `<family>-<16 hex characters>.<extension>`; the extension follows the bytes, not the uploaded name. A write stages its bytes and renames them into place.
- Fonts served to a browser come from the machine running `dsh`, so every browser connected to this deployment can use them.

### Uninstall

```text
dsh plugin --profile web remove dsh-plugin-ui-font-family
```

That removes the row and stops serving the fonts. Two things stay behind:

- **Uploaded files** in `$DSH_HOME/fonts`. Delete that directory to remove them, or keep it and install the package again later.
- **The saved selection** in `$DSH_HOME/settings.yaml` under `ui-font-family`. It is inert without the package and can be deleted with it.

### Fonts when the Host runs elsewhere

The installed-font list describes the machine running `dsh` and is served only to requests from that machine, so a browser on another machine gets no system group. Remote users can still choose an uploaded font, and a deployment can set `defaultFamily` to a `system` family name that exists on the browser's own machine: the Host validates the name for safe output, not for presence.

A reverse proxy running on the Host's machine makes remote requests arrive from a local address, which counts as the same machine. Withhold the installed-font list from such a deployment by setting `scanSystemFonts: false`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package has a Host half and a browser half, joined by `package.json` (`dsh.client` and the `./client` export). The Host registers the settings section, scans font directories, answers the HTTP routes, and injects the pre-plugin row; the browser renders the settings row and projects every change onto the document.

| Path | Role |
|---|---|
| `src/index.ts` | Host plugin body: config resolution, the settings section, the index-injection row, route registration. |
| `src/font-routes.ts` | Catalogue, download, upload, and delete routes, with the same-origin and same-machine rules. |
| `src/user-fonts.ts` | The upload directory: storing, listing, and deleting files, with a per-file identity cache. |
| `src/system-fonts.ts` | The installed-font index: platform directories, a bounded concurrent scan, and the same identity cache. |
| `src/font-selection.ts` | Resolving a selection to families and placing them ahead of the harness stack; shared by both halves. |
| `src/font-settings.ts`, `src/font-settings-schema.ts` | The settings namespace, the family-name rule, and the schema the Host registers. |
| `src/boot-font.ts`, `src/font-face.ts` | The pre-plugin row and the `@font-face` block written into the served page. |
| `src/client/` | The row, picker, management dialog, runtime, and the theme token layer that installs the stack. |

Two decisions shape the rest. The boot row declares `@font-face` for the selected stored font only, because an index response cannot wait for a file read and the browser half declares the rest from the catalogue it reads on mount. Family names come from font files and from the settings document, so a character rule gates every name before it reaches the stylesheet or the served script.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Package and install a plugin](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) — bundles, profiles, and the layer order this package installs into.
- [Add a settings card](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-settings-card.md) — the settings-section and slot registration this row uses.
- [Web styling](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/web-styling.md) — the token and styling rules the installed stack follows.
- [ui-theme](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/client/ui-theme) — the Font size row above this one, and the pre-plugin bootstrap this row mirrors.
- [License](LICENSE) — MIT.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits are current package constraints; they define what a font cannot change and what this deployment does not do.

- **Interface text only** — code blocks, diffs, and terminal output keep the harness's monospace stack; installing a proportional font there would break their alignment.
- **A preset names only the faces it changes** — the harness's own stack stays behind every installed stack, so text outside a chosen font's coverage, including Chinese when a preset has no Chinese face, is drawn by the harness's faces at their own metrics.
- **Some fonts change the text height** — line boxes come from the font's ascent and descent, so a face with unusually large vertical metrics draws taller lines than the harness measured for. The plugin places families and never rewrites metrics, and it cannot correct a font whose metrics differ.
- **One face per family** — a stored font's own weight and style variants are not offered, and bold text is synthesized from the single face.
- **A collection (`.ttc`) reports one family per contained face** — choosing any of them downloads the whole collection file.
- **Uploads are capped per file, not in total** — `maxUploadBytes` bounds one file; nothing bounds the size of the directory.
- **The installed-font list is only served to requests from the machine running `dsh`** — a security rule rather than a config field, so a browser elsewhere sees no system group even when it could use those fonts.
- **A reverse proxy on the Host's machine defeats that rule** — the judgement reads the peer address, and a local proxy is a local peer. Deployments that front `dsh` this way must set `scanSystemFonts: false`.
- **A crash during a write can leave one `.staging` file** — every read ignores it and it is never served; delete it by hand if it is in the way.
- **Deferred** — no total-upload quota, no per-face selection for collections, and no browser-local font enumeration, which the browser platform does not expose; uploaded fonts and the `system` default exist for that deployment shape.

**Runtime invariant:** No runtime invariant companion is published because every remembered family name is re-validated against the file's identity before reuse, so the catalogue cannot report a file the directory no longer holds.
