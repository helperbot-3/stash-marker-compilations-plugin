# Marker Compilations for Stash

A native Stash page for arranging marker intervals into reusable compilations.
Compatible with **Stash v0.31.1**. Follows the Library Triage plugin's native
PluginApi React UI, Settings → Tools entry point, and plugin source packaging.

## Install from Stash (recommended)

Once GitHub Pages has deployed, add this source under **Settings → Plugins → Available Plugins → Sources**:

`https://helperbot-3.github.io/stash-marker-compilations-plugin/main/index.yml`

Reload the available plugins, install **Marker Compilations**, then refresh the browser.
Open **Compilations** in Stash’s main navigation. Updates are delivered through
this same source, just like Library Triage.

If you installed 0.1.0–0.3.0, the package date was missing, so Stash's update filter
hides the upgrade. Under **Installed Plugins**, click **Check for updates**, then
**Show all**, select **Marker Compilations**, and click **Update** once. Refresh the
browser afterward. Version 0.3.1 repairs this metadata for subsequent updates.

Repository: https://github.com/helperbot-3/stash-marker-compilations-plugin

## Manual install

1. Ensure Python 3.9+ is available on the **Stash server**. No Python packages are required.
2. Copy the entire `plugins/marker-compilations` directory into Stash's configured plugins directory.
   Keep `marker-compilations.yml` **inside** that directory beside `backend.py` and `ui/`.
3. In Stash, choose **Settings → Plugins → Reload plugins**, then reload the browser.
4. Open **Compilations** in Stash’s main navigation (or `/marker-compilations` on your Stash server). The Settings → Tools link remains available.

For Docker, Python and FFmpeg must be available inside the Stash container. The
plugin uses Stash's configured FFmpeg path, falling back to `ffmpeg` on PATH.
The Stash process needs write access to its configuration directory and the plugin
folder. No separate service, npm installation, or frontend build is needed to run it.

## Use

1. The **compilation library** is the landing view. Choose a saved compilation from the visible list,
   search by name, and play it in the large viewport. Use **Edit compilation** to
   edit the selection, or **New compilation** to start a new one.
   The main navigation includes a filmstrip icon. The editor has a compact two-column
   inspector with trim controls and no internal vertical scrollbars. Clip actions,
   position, zoom and preparation controls live above the timeline.
2. In the nested **editor**, use the single **+ Add markers** button to browse and filter
   markers by search/tag. **In project** marks those already imported. Add markers,
   then click **Done**. This collects media without changing the timeline.
   **Project media** lives in a collapsible left sidebar with one scrollable list (no pages) and keeps these markers independently of timeline positions. Drag
   a compact thumbnail row onto the timeline to insert before/after the nearest clip, or use **Insert**
   to add it after the selection. Marker stills are loaded from Stash, including for
   existing projects; unavailable stills show a placeholder. A thumbnail badge shows
   how often the marker appears on the timeline. Each insertion has independent trim/pattern settings.
   Removing a timeline clip keeps its catalog entry. Use **×** on a media item to remove
   it from the catalog while keeping timeline copies and source markers unchanged.
   **Undo** restores the last removed item while the catalog remains open. Save the
   project to keep removals. Filter media by **All / Used / Unused**, or sort by
   added order, name or duration. Existing projects automatically
   seed their catalog from saved timeline clips; their timeline stays unchanged.
3. Single-click to select a timeline clip. Double-click (or press **Enter** on it) to open the compact two-column **Inspector**. The left
   column has the scrubber, 1 / 5 / 10-frame steps, and start/end
   fields. The main viewport switches to **Trim selected clip** when opening the
   inspector or using a trim control. **Escape**, the inspector close button, or
   **Compilation** returns to the main timeline view, retaining applied edits; only
   one video is visible. Use the arrow next to a boundary to jump there, or **Set** to use the
   current preview position. **Play range** previews just the interval. Changes
   apply directly to the compilation clip; the original Stash marker is unchanged.
   Trim fields and the source clock show fixed-width `HH:MM:SS:FF` timecodes (FF is
   the frame field), using the source rate and non-drop-frame numbering. Old `m:ss`
   and `h:mm:ss` inputs with fractional seconds remain accepted. Merely focusing a
   field does not round or change existing trims. Frame steps read actual source
   presentation timestamps through Stash's configured FFprobe. Progressive H.264/H.265
   in MP4/MOV/Matroska use packet presentation timestamps without decoding the video;
   other formats or incomplete timestamps fall back to decoded frames, including unevenly
   spaced frames, and prepare a nearby window after seeking for quick repeated steps. Recent windows
   are reused for two minutes while the editor remains open, including when reopening
   an inspector. The trim player preloads video; cold backward seeks can still take
   longer when the browser needs to fetch and decode an earlier keyframe. **Set** snaps
   to a source frame boundary; the end boundary remains exclusive. For variable-rate
   video, timecode is a nominal source-rate reference rather than a unique frame
   index; stepping still uses actual frame timestamps. Transcoded playback can
   display different frames if it changes the source rate. If FFprobe or the source
   file is unavailable, the editor reports that frame stepping is unavailable.
4. The right column edits the ordered repetition/speed phases. Drag timeline clips
   to reorder, use the timeline toolbar arrows, or press **Alt + Left / Right** on a clip.
   Use **Zoom / Fit** for long timelines. **Cmd+C/X/V** (or Ctrl on Windows/Linux)
   copies/cuts/pastes the selected clip, including its trim and repeat/speed pattern.
   Paste inserts after the selection, or at the end of an empty/unselected timeline.
   **Delete / Backspace** removes the selected clip. Clipboard shortcuts also work
   between compilation editors; ordinary text editing and other pasted text are untouched.
5. **Space** plays or pauses the inspected source preview while the inspector is open,
   and the compilation timeline otherwise. In the inspector, **Left / Right** step
   exactly one source frame (regardless of the step dropdown); **Up / Down** seek
   backward / forward one second. Seeking pauses the preview and leaves trim boundaries
   unchanged. Arrow keys keep their normal behavior in editable fields and dropdowns.
   Space leaves text
   typing fields and dialogs alone. Focused buttons, dropdowns, numeric controls,
   and sliders do not consume Space or activate their normal action. Starting timeline playback pauses the source
   trim preview, and starting the source preview stops timeline playback.
6. **Save** persists edits. **Back to compilations** with unsaved edits offers **Save and return**,
   **Discard edits**, or **Keep editing**. The library list always contains saved versions. Existing saved
   compilations remain compatible.
7. Select a timeline clip and use **Play clip** to play from it, or seek on the ruler/position slider.
   **Fullscreen** expands the main viewport and playback controls.

Use **+ Zone** in the inspector to define non-overlapping hot zones. Select a
numbered zone to name it, edit frame timecodes, jump to a boundary, or use **Set**
with the main preview. Setting Start at or beyond End moves End forward to preserve
the previous duration, capped at the next zone or clip boundary. A start inside
another zone or outside the clip still needs correction.

The inspector places clip trim and hot zones side by side, with a full-width
**Sequence** editor underneath. Compact boxes show **Full**, **All**, or the zone
number, with badges only for non-default repeats and speed. Each block independently
chooses **Full clip**, **All hot zones**, or an individual named/numbered zone,
along with a repeat count and speed. Click a block to edit its fields and preview
its start in the main viewport. Drag to reorder, or use the arrow buttons.
**+ Step**, **Duplicate**, and **Remove** edit the sequence; focused blocks support
Delete/Backspace and Cmd/Ctrl+D. **Play sequence** plays just the selected clip’s
complete arrangement. Block widths are equal; selecting a block reveals its range, speed, and repeats.

For example: Zone 1 twice at normal speed → Zone 1 once at half speed → Full clip
once at normal speed → Zone 2 once at half speed. All hot zones plays each zone
chronologically within each repetition, falling back to the full clip when there
are none. Individual missing zone references require choosing a replacement.

Zones have stable identities, so timing changes do not redirect their steps.
A referenced zone cannot be removed until its steps are reassigned or removed.
Existing patterns convert automatically with the same playback order and speeds.
Up to 200 steps and 20 hot zones are supported per clip.

**Save / manage patterns** uses the same sequence controls. Save, rename, update,
copy, or delete named templates. **Save as new** saves an independent copy immediately.
Templates map zone references by chronological number when applied to another clip;
missing zones are flagged as **Choose range** and block playback until resolved.
**Apply to all clips** maps the sequence onto each clip while keeping their trims
and zone boundaries. Prepared clips retain the full source interval, so changing
sequences or zones does not require generating clips again.

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

## Capture highlights now, tag and refine later

Open a scene and select **Create markers**. The workspace opens that scene directly,
with a large video and a highlight list. When entering from the compilation header,
choose a scene first.

1. **Capture:** press **I** at the beginning of a highlight, then **O** at its end.
   Finishing automatically saves an untagged draft. Playback continues, and you can
   immediately capture the next highlight. No title, tag or separate save click is required.
2. **Refine later:** click a highlight to edit its range, title, tags and hot zones
   in the same video viewport. **Keep draft** (or Enter) saves edits without creating
   a regular marker. Returning to **Capture** or selecting another highlight also
   saves the current draft's edits.
3. **Publish:** choose a primary tag and **Save to Stash**. To work in batches,
   select highlights, choose a tag and **Apply tag**, then **Save selected to Stash**.
   Published drafts become ordinary Stash scene markers and leave the draft list.

- **Space** plays/pauses. Arrows step frames (left/right) or seconds (up/down).
  Navigation preserves playback state. **Escape** leaves text fields and dropdowns
  to return to video shortcuts. In Capture, Enter also finishes a highlight.
- Drafts persist in the plugin's SQLite database, including untagged ranges and hot
  zones. A browser recovery copy protects pending captures and unsaved refinement
  edits. Failed saves remain visible with **Retry**; errors do not silently discard drafts.
- **Existing Stash markers** opens a draft copy for refinement. Choose **Update original**
  to change that marker, or **Save as new** to create another. Capture never edits
  existing markers automatically.
- Expand **Also add published markers to a compilation** to collect published markers
  in project media without inserting timeline clips.
- Recent tags and **☆** pinned favorites remain available during refinement.
  Blank titles use the chosen tag's name when publishing.

The compilation clip inspector also provides **Update original marker** and
**Save as new marker**. Review the title/tags before saving. Range/title/tag edits
are stored in Stash, so the markers work in its regular marker collection. Named
hot zones are stored in the plugin's SQLite database and copied on future imports
through Add markers. Back up that database to preserve them. Stash's native marker
editor does not display these hot zones; if its marker range changes externally,
stale plugin zones are ignored. Repeat/speed sequences remain compilation-specific.

Updating an original never silently rewrites existing compilation clips or media
catalog copies. Update checks reject changes made to the original while the form
was open; reopen the form to review the current original before trying again.

## Render a complete video

Choose **Render video** from a saved compilation or the editor, select 720p or 1080p,
and start rendering. Unsaved edits are saved first. The background job renders the
saved sequence, including every full-clip/hot-zone step, repeat and speed change,
into one MP4 (H.264, 30 fps, optional AAC audio). Aspect ratios are preserved with
black padding; slowdown preserves audio pitch. Cuts are rounded to output frames.

**Add to Stash library** is enabled by default. Choose a configured video library
folder: the video is written into its `Marker Compilations` subfolder, scanned,
and registered as a regular scene with the compilation title and `Marker Compilations · Rendered`
tag. Previously rendered scenes tracked by the plugin receive this tag when you
open their compilation; existing tags are preserved. Source performers and tags can optionally be copied. If import fails, use
**Retry import**; the completed video is retained.

Disable library import to keep the video in
`<Stash config directory>/marker-compilations/renders`. Either option supports
**Watch rendered video** and **Download** in the rendered versions list. Library
versions also have **Open scene**. Files play through Stash's authenticated plugin
asset endpoint; access links are recreated after plugin updates.

Each render is an independent snapshot and file. Editing a project marks prior
versions as older; it never silently replaces a video. Deleting the project does
not delete its rendered files. Back up rendered files as well as the plugin database.
The plugin does not automatically reclaim this storage. Rendering needs FFmpeg,
ffprobe, readable source files and write access to the destination. In Docker,
these paths and permissions must be available inside the Stash container.

Jobs run in Stash's task queue. Close the dialog and keep editing while a render
runs; return to it for progress, cancellation and completed versions.

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
