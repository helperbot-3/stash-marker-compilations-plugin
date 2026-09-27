# Marker Compilations for Stash

A native Stash page for arranging marker intervals into reusable compilations.
Compatible with **Stash v0.31.1**. Follows the Library Triage plugin's native
PluginApi React UI, Settings → Tools entry point, and plugin source packaging.

## Install from Stash (recommended)

Once GitHub Pages has deployed, add this source under **Settings → Plugins → Available Plugins → Sources**:

`https://helperbot-3.github.io/stash-marker-compilations-plugin/main/index.yml`

Reload the available plugins, install **Marker Compilations**, then refresh the browser.
Open **Settings → Tools → Open Marker Compilations**. Updates are delivered through
this same source, just like Library Triage.

Repository: https://github.com/helperbot-3/stash-marker-compilations-plugin

## Manual install

1. Ensure Python 3.9+ is available on the **Stash server**. No Python packages are required.
2. Copy the entire `plugins/marker-compilations` directory into Stash's configured plugins directory.
   Keep `marker-compilations.yml` **inside** that directory beside `backend.py` and `ui/`.
3. In Stash, choose **Settings → Plugins → Reload plugins**, then reload the browser.
4. Open **Settings → Tools → Open Marker Compilations** (or `/marker-compilations` on your Stash server).

For Docker, Python and FFmpeg must be available inside the Stash container. The
plugin uses Stash's configured FFmpeg path, falling back to `ffmpeg` on PATH.
The Stash process needs write access to its configuration directory and the plugin
folder. No separate service, npm installation, or frontend build is needed to run it.

## Use

1. Click **+ Add markers** to open the marker browser. Search or filter by tag,
   add clips, then click **Done** to return to the editor.
2. Each marker becomes a box on the **Timeline**. Click a box to select it;
   its **Inspector** shows source start/end and repeat/speed settings.
3. Drag clips to reorder them, use **Earlier / Later** in the Inspector, or press
   **Alt + Left / Right** on a focused clip. Use **Zoom / Fit** for long timelines.
4. Set a name and **Save**. Open existing projects or create a new one through
   **Compilations**. Previously saved compilations remain compatible.
5. Click **Play compilation** for the large preview. Double-click a timeline clip
   to start there, or seek using the ruler or position slider. **Fullscreen** expands
   the preview and playback controls; Escape returns to the editor.

The Inspector's **Repeat & speed** phases each have a repeat count and speed.
Choose **3 normal → 2 slow → 3 normal**, the 2/2/2 preset, or your own phases.
**Use this pattern for all clips** copies the selected pattern while retaining
individual source trims. Options in the marker browser set defaults for new clips.

Speeds range from 0.25× to 3×, with 1–20 repeats per phase and up to 10 phases.
All phases of a clip finish before the next clip starts. Timeline widths and the
playhead account for repeats and speed, showing actual viewing time. Editing a
clip stops playback so the next preview uses the updated sequence.

Markers with an end use their full interval; others use the marker browser's
fallback duration, capped at the source duration. Choose **Source videos** in the
preview to play from original scenes. The stream selector can switch to another
browser-compatible Stash stream.

For generated intervals, open **Clip cache**, choose width/audio, and click
**Generate clips**. Then select **Cached clips** in the preview. These intervals
have no 20-second preview cap. Repetition and speed changes reuse the same files
without further encoding. Pitch preservation is requested from the browser.

The cache is optional. Transitions can buffer; playback is not guaranteed to be
frame-perfect or gapless. Source mode uses browser-supported progressive streams;
HLS/DASH-only sources should use cached clips. Native Stash playback integrations
such as interactive devices are not implemented in this player.

## Storage and behavior

- Compilations are stored in `<Stash config directory>/marker-compilations/compilations.sqlite3`.
  Back up this folder along with your Stash configuration; Stash's own database backup
  does not include this separate database.
- Each entry stores the source scene, marker reference and a snapshot of its start/end.
  Editing or deleting the original marker does **not** silently change a compilation.
  Remove and re-add a marker to adopt its updated times.
- Concurrent saves use revision checks so another browser cannot silently overwrite edits.
- Cached MP4s live in `<plugin directory>/cache`. They are shared across compilations with
  identical source/trim/quality settings. Changed trims, source size/mtime, width or audio
  use a new cache key. Old clips are retained; removing this cache directory while no
  generation job is running safely reclaims its space. Regenerate afterward.
- Plugin updates may remove cached clips, but saved compilations remain in the config directory.
- Deleting a compilation preserves source files, markers and reusable cache files.
- Cached videos are available through Stash's authenticated plugin asset endpoint.
- Invalid ranges, deleted scenes and missing cached clips are reported before playback.
- Generation runs in Stash's task queue. Cancelling also terminates its FFmpeg worker;
  completed clips are kept for reuse, while interrupted output is removed.

Standalone compilation export is a future feature. This version implements source
playback and reusable individual clips without creating a new scene in the library.

## Packaging and development

`python3 build_site.py` produces `_site/main/marker-compilations.zip` and a Stash source
`index.yml`. Packaging uses an explicit allowlist: it cannot include cached footage,
compilation databases, test data or development dependencies. The GitHub Pages
workflow uses the same source-index convention as Library Triage; enable Pages with
GitHub Actions in your chosen repository to publish it.

Tests: `npm ci && npm test`. FFmpeg/ffprobe are required for media integration tests.
With a **disposable** Stash v0.31.1 instance running, set `STASH_TEST_URL` to also
validate every UI GraphQL operation against the real schema. `node tests/browser.cjs`
exercises both playback modes, repeat/speed patterns, persistence, mobile layout and the actual Stash UI using Chrome and seeded test markers named `Long interval`
and `Closing clip`. It writes test compilations and cached media: never point it at a
production instance.
