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

- Find markers by search and tag; add them in any order, including repeated markers.
- Markers with a valid end use the full interval. Others use the default duration
  shown in the editor, capped at the source duration.
- Set a name, adjust start/end seconds, reorder clips with the arrow buttons, and save.
- Each clip has a **Repeat & speed pattern**: an ordered list of phases, each with a
  repeat count and playback speed. Use the **3 normal / 2 slow / 3 normal** preset,
  or edit it to any variant (for example 2× normal, 2× at 0.75 speed, 3× normal).
  The marker browser also offers a 2/2/2 preset and an **Apply pattern to all clips** action.
- Speeds: 0.25×, 0.5×, 0.75×, 1×, 1.25×, 1.5×, 2× and 3×. Each phase supports
  1–20 repeats; each clip supports up to 10 phases. All phases of one clip finish
  before the next clip starts. Total duration includes repeats and playback speeds.
- Patterns work in both playback modes. Repeats reuse the same video element when
  the source URL is unchanged, and cached clips remain at normal speed: changing a
  pattern needs no additional encoding or duplicate media. Pitch preservation is
  requested from the browser during slow/fast playback.
- **Play sources** seeks each source video to the selected start and advances at its end.
  A source selector allows switching to another browser-compatible Stash stream.
- Under **Full-duration clip cache**, choose maximum width and whether to include audio,
  then **Generate clips**. Progress appears in the editor and Stash's task queue.
- **Play cached clips** plays the generated intervals. Unlike built-in marker previews,
  these clips have no 20-second cap. The entire compilation is still an editable list.

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
