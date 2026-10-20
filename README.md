# Drawio Preview

[English](README.md) | [简体中文](README.zh-CN.md)

Drawio Preview renders `.drawio` diagrams inside Obsidian — both as inline embeds and as the file view — without opening an embedded editor. Diagrams are drawn as SVG by a bundled drawio viewer, and on desktop a click opens an interactive viewer where you can zoom, pan, go fullscreen, or hand the file to your local drawio app for editing.

![Drawio Preview in action](https://github.com/user-attachments/assets/c70cce74-0450-41e3-a9e8-8aeb98738f99)

## Features

- **Read-only preview.** `![[Diagram.drawio]]` and `.drawio` files render immediately. Editing stays in your desktop drawio app — the viewer's **Edit** button opens the file with your system's default application.
- **Preview cache.** The first render of a diagram takes a moment; afterwards the SVG is served from a cache, so the drawio viewer is not loaded again.
- **Link-driven sizing.** Native wikilink syntax controls the box: `![[Diagram.drawio]]` fits the pane width, `![[Diagram.drawio|400]]` pins a width, `![[Diagram.drawio|400x300]]` pins width and height. Diagrams scale proportionally inside the box.
- **Multi-page support.** Diagrams with several pages get `‹` / `›` controls, and the pin button writes the current page into the link so the note remembers it.
- **Interactive viewer (desktop).** Zoom in/out, fit to box, pan a zoomed diagram, and go fullscreen. `Esc` leaves fullscreen.
- **Three appearances.** Light, dark, or transparent, or follow Obsidian's current theme automatically.
- **Create new diagrams.** A command, a ribbon button and a folder context-menu entry create an empty `.drawio` file — at the attachment folder, next to the current note, or in a folder you pin in the settings.

## Installation

### From the community plugins directory

1. Open **Settings → Community plugins** in Obsidian and make sure restricted mode is off.
2. Select **Browse**, search for **Drawio Preview**, and install it.
3. Enable the plugin.

### Manual installation

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/nnq7/obsidian-drawio-preview/releases/latest).
2. Create the folder `<your-vault>/.obsidian/plugins/drawio-preview/` and put the three files in it.
3. Reload Obsidian, then enable **Drawio Preview** under **Settings → Community plugins**.

## Usage

### Embed a diagram

```markdown
![[Diagram.drawio]]
![[Diagram.drawio|400]]
![[Diagram.drawio|400x300]]
![[Diagram.drawio#Page-1]]
```

The size syntax is the same one Obsidian uses for images, so it behaves the way you already expect. Editing the number in the link resizes the preview immediately.

### Interact with the preview

Click a preview to activate it. A toolbar appears in the top-right corner:

| Button | Action |
| --- | --- |
| `+` / `−` | Zoom in / out (desktop) |
| Fit | Return to the fitted view |
| Edit | Open the file in your default application (desktop) |
| Fullscreen | Expand the preview to the whole screen (desktop) |
| `×` | Leave fullscreen |

While zoomed, drag the diagram to pan. Click outside the preview to deactivate it.

### Multi-page diagrams

Use `‹` and `›` to flip pages. The pin button writes the page you are looking at into the embed's link, so the note keeps showing that page after a reload.

### Create a new diagram

Use the command **Drawio Preview: New diagram**, the ribbon icon, or **New drawio diagram** in a folder's context menu. Where the file lands is controlled by the **New diagram location** setting.

## Settings

| Setting | Description | Default |
| --- | --- | --- |
| **New diagram location** | Where diagrams created by the command are saved: follow Obsidian's attachment folder, the folder of the current note, or a folder specified below. | Follow attachment folder |
| **Folder specified below** | Only editable when the location is set to a specified folder. Supports folder autocomplete; created automatically if missing. | — |
| **Diagram preview appearance** | When following the theme is on, the preview matches Obsidian's light/dark theme and the dropdown is disabled. Otherwise the dropdown picks light, dark, or transparent. | Follow theme with light |
| **Cached preview files** | Maximum number of cached SVGs. The oldest files are removed first. Only cache files are deleted, never your diagrams. | 20 (range 10–30) |

## Data, privacy and permissions

Drawio Preview is designed to work fully offline:

- **No network requests.** The drawio viewer is bundled in `main.js`; nothing is downloaded at runtime.
- **No telemetry and no analytics.** The plugin does not collect, transmit, or store usage data.
- **Vault access is read-only**, with two deliberate exceptions:
  - The **Edit** button asks the operating system to open a single `.drawio` file with its default application.
  - The preview cache is written to `<your-vault>/.obsidian/plugins/drawio-preview/cache/`. It holds rendered SVG files only, is capped by the setting above, and can be deleted at any time — the plugin simply regenerates it.
- **No access to files outside your vault.**
- The mobile app shows a static preview with no interaction.

## Frequently asked questions

**Why is the first open slow?**
The first time a diagram is shown, the plugin loads the bundled drawio viewer (roughly 2.7 MB) and renders the diagram. The result is cached, so the same page opens almost instantly afterwards. A different page or an edited file needs one new render.

**The Edit button does nothing.**
It hands the file to your operating system, so a `.drawio` file needs an associated application. Install the drawio desktop app (or point the file type at the web app) and try again.

**Where does the cache live, and can I clear it?**
`<your-vault>/.obsidian/plugins/drawio-preview/cache/`. Delete the folder whenever you like; it is rebuilt on demand. The number of files kept is controlled by the **Cached preview files** setting.

## Credits and license

- Draws on [doge-liang/obsidian-drawio](https://github.com/doge-liang/obsidian-drawio) (MIT); the original author is credited in [LICENSE](LICENSE).
- Bundles the [drawio](https://github.com/jgraph/drawio) viewer, version **v31.1.8**, which is licensed under Apache-2.0. Its license text is included in [`licenses/drawio/`](licenses/drawio/).
- This project is released under the [MIT license](LICENSE).

## Contributing

Bug reports and pull requests are welcome — please open an [issue](https://github.com/nnq7/obsidian-drawio-preview/issues) first for anything larger than a fix, so we can agree on the approach.

When reporting a problem, include your Obsidian version, the plugin version, and whether the diagram is an embed or a `.drawio` file view. A minimal `.drawio` file that reproduces the issue helps more than a screenshot.
