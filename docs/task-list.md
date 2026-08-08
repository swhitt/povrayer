# povrayer task list

This is the working backlog for making povrayer faster, clearer, and easier to
grow without turning it into a big platform too early.

The default order is:

1. Keep Pages and local static usage flawless.
2. Remove user-facing papercuts that make the current app feel rough.
3. Make the gallery/catalog cheap to scale.
4. Add Vercel-only capabilities behind clean seams.
5. Refactor large files only after the seams are visible in tests.

## Operating rules

- Do not bypass lint, coverage, hooks, or CI gates.
- Keep static hash links, `?example=...`, and local-first editing working.
- Keep GitHub Pages lean; expanded gallery and future storage are Vercel-only
  unless the asset budget says otherwise.
- Prefer one behavior change per commit.
- For UI changes, verify with `playwright-cli`.
- For refactors, preserve behavior first, then move code.

## Ready queue

These are the highest-value items that should be small enough to do without
reshaping the whole project.

- [x] Let edited heavy examples use auto preview again.
  - Current guard suppresses drafts based on the loaded example record even after
    the user edits that scene.
  - Acceptance: pristine slow examples still do not auto-render; edited scenes
    can draft again when auto preview is enabled.
  - Touchpoints: `web/ui.js` `canAutoDraftCurrentScene()`, `scheduleDraft()`.

- [x] Abort stale live drafts immediately on edit.
  - Current edits debounce the next draft, but an expensive in-flight draft can
    keep running until the debounce fires.
  - Acceptance: typing during an active draft cancels the old draft promptly and
    schedules only the latest source.
  - Touchpoints: `web/live-draft.js`, `web/ui.js` input scheduling.

- [x] Add live-draft backoff for slow scenes.
  - If a draft exceeds a threshold, pause auto preview for that scene/session and
    require an explicit Render.
  - Include conservative draft defaults for quality and thread count.
  - Acceptance: slow drafts do not repeat indefinitely after each edit; the UI
    says why preview paused.
  - Touchpoints: `web/live-draft.js`, `web/ui.js` draft settings.

- [x] Preserve gallery filters while the gallery stays in the current session.
  - Opening and closing the gallery currently resets exploration context.
  - Reset filters only through the clear action or a hard reload.
  - Acceptance: close/reopen keeps query and filters; Clear resets everything.
  - Touchpoints: `web/ui.js` `openGallery()`, `closeGallery()`,
    `resetGalleryFilters()`.

- [x] Clarify status language.
  - Prefer explicit strings like `render failed`, `render cancelled`,
    `preview paused`, and `preview error`.
  - Acceptance: every cancelled, failed, paused, and completed path uses a
    distinct status string.
  - Touchpoints: `web/ui.js` draft/full render status paths.

- [x] Fix direct `/x/<slug>` navigation before shipping short links.
  - Rewrites preserve the visible URL, so relative assets in `index.html` can
    resolve under `/x/`.
  - Lowest-risk first step: redirect `/x/<id>` to `/?x=<id>` until the app shell
    is base-path safe.
  - Acceptance: direct navigation to `/x/demo` loads assets on Vercel-style
    routing and the browser test server covers it.
  - Touchpoints: `vercel.json`, `web/index.html`, `test/browser/serve.mjs`.

## UI polish

- [x] Make loaded gallery-card styling quieter.
  - Use neutral loaded treatment instead of accent borders so accent stays
    reserved for focus/progress/primary actions.
  - Acceptance: selected, focused, hovered, and loaded states are visually
    distinct without competing yellow outlines.
  - Touchpoints: `web/styles.css`, `web/ui.js` `setTriggerLabel()`.

- [x] Tone down gallery hover styling.
  - Lowest priority. The current hover/focus treatment can wash a card almost
    white, muting thumbnail detail and making text feel disabled.
  - Acceptance: hover/focus reads as active without inverting the whole card or
    reducing thumbnail contrast.
  - Touchpoints: `web/styles.css` gallery-card states.

- [ ] Distinguish modified-from-example from edited-since-render.
  - Track the last successfully rendered source separately from
    `lastLoadedSource`, then mark stale output/stats when editor text diverges.
  - Acceptance: the app can show both "changed from example" and "render output
    is stale" without conflating them.
  - Touchpoints: `web/ui.js` scene dirty state, render success, stale output UI.

- [ ] Improve mobile example-row layout.
  - On narrow/coarse-pointer screens, let the label sit above the example trigger
    and Gallery button so long titles do not get crushed.
  - Acceptance: the control row has no clipped title/button text at common mobile
    widths.
  - Touchpoints: `web/index.html`, `web/styles.css`.

- [x] Add non-visual shortcut metadata.
  - Add `aria-keyshortcuts` for existing shortcuts without adding visible chrome.
  - Acceptance: shortcut metadata exists on relevant controls and no UI clutter
    is added.
  - Touchpoints: `web/index.html`, `web/ui.js`.

- [x] Add a lightweight Gallery keyboard shortcut.
  - Keep `Ctrl/Cmd+K` for the compact picker; add `Ctrl/Cmd+Shift+K` for Gallery.
  - Acceptance: the shortcut opens Gallery, respects existing input focus rules,
    and is listed anywhere shortcuts are surfaced.
  - Touchpoints: `web/ui.js` global shortcuts, shortcuts dialog markup.

- [ ] Make number scrub discoverability contextual.
  - While Alt is held, subtly mark scrubbable numeric tokens in the overlay.
  - Acceptance: discoverability appears only during the modifier state and does
    not move text or desync the editor overlay.
  - Touchpoints: `web/ui.js` number scrub handling, `web/styles.css`.

## Performance and runtime

- [x] Prewarm renderer startup without changing render semantics.
  - Warm the wasm factory after page load so the first render pays less visible
    startup cost.
  - Benchmark before considering deeper worker-pool or reusable-instance work.
  - Acceptance: prewarm cannot trigger a render, change state, or break Pages.
  - Touchpoints: `web/render-client.js`, `wrapper/src/index.ts`.

- [x] Tune browser thread defaults.
  - Keep short-lived drafts to a small worker pool while allowing full renders to
    use the wrapper's hardware-concurrency default.
  - Acceptance: drafts use a lower default than full renders; explicit user
    thread choices still win.
  - Touchpoints: `web/ui.js`, `web/render-client.js`, `wrapper/src/index.ts`.

- [x] Avoid staging every dropped asset for every render.
  - Pass only files referenced by the current scene when possible, and warn for
    large asset sets.
  - Acceptance: scenes with many dropped assets do not restage unrelated files
    for every draft/full render.
  - Touchpoints: `web/asset-drop.js`, `web/ui.js`, `wrapper/src/index.ts`.

- [x] Reduce animation memory spikes.
  - Decode frames with limited concurrency and enforce a conservative memory
    budget from frame count and resolution before wasm starts.
  - Acceptance: large animations fail early with a clear message instead of
    exhausting tab memory.
  - Touchpoints: `web/render-client.js`, `web/player.js`.

- [x] Tighten animation cleanup paths.
  - Release bitmap/canvas storage in `player.destroy()`, revoke partial blob URLs
    on failure, and clean up on pagehide and mode switches.
  - Acceptance: cancelled/failed animations do not leave raw PNG buffers or blob
    URLs retained.
  - Touchpoints: `web/player.js`, `web/render-client.js`, `web/ui.js`.

- [x] Defer expensive editor work on input.
  - Coalesce highlighting and slider rebuilding to the next animation frame.
  - Acceptance: typing stays responsive on large scenes; overlays remain synced.
  - Touchpoints: `web/ui.js`, `web/complete.js`, `web/context.js`.

- [x] Improve long-render progress feedback.
  - Patch progress flushing so long renders visibly advance instead of emitting
    late status bursts.
  - Acceptance: long renders show periodic progress without changing trace
    output semantics.
  - Touchpoints: `web/render-client.js`, wrapper stdout plumbing.

## Catalog and gallery scale

- [x] Stop prebuilding the entire gallery DOM.
  - Render the first visible batch, then append on scroll/filter.
  - This keeps startup cheap when the catalog grows.
  - Acceptance: gallery startup cost is bounded when the catalog grows past the
    current example count.
  - Touchpoints: `web/ui.js` `buildGallery()` / `renderGallery()`.

- [ ] Split catalog metadata from scene source.
  - Load a lightweight manifest at startup; lazy-load scene text only when a
    scene is selected or rendered.
  - Preserve a synchronous metadata helper and introduce async source loading.
  - Acceptance: initial JS payload no longer contains every sourced POV body.
  - Touchpoints: `web/examples.js`, `web/examples-sourced.js`, `web/ui.js`,
    `web/repl.js`.

- [ ] Make example records fully self-describing.
  - Move attribution and performance data into records or generated metadata.
  - Add fields such as `origin`, `upstreamTitle`, `upstreamAuthor`, `adapter`,
    `sourcePath`, `sourceCommit`, `licenseUrl`, and `derivedFrom`.
  - Acceptance: sourced records have enough metadata to audit provenance without
    opening generated code.
  - Touchpoints: `web/examples.js`, `web/examples-sourced.js`,
    `test/node/examples.test.mjs`.

- [ ] Introduce a catalog build step.
  - Move source-of-truth examples toward `content/examples/<slug>/scene.pov`,
    `metadata.json`, optional `assets/`, and generated web artifacts.
  - Acceptance: generated catalog files are reproducible and checked by tests.
  - Touchpoints: new catalog generator, `tools/examples-docs/generate.mjs`,
    `tools/example-thumbnails/generate.mjs`.

- [ ] Formalize performance tiers as operational metadata.
  - Derive UI defaults, thumbnail quality, verification quality, and auto-draft
    safety from one metadata source.
  - Include `previewQuality`, `thumbnailQuality`, `verifyQuality`, `estimatedMs`,
    `memoryTier`, and `safeForLivePreview`.
  - Acceptance: UI/render/test decisions read the same tier data.
  - Touchpoints: `web/examples.js`, `tools/example-thumbnails/generate.mjs`,
    `test/node/examples-render.test.mjs`.

- [ ] Add catalog-level multi-file scene support.
  - The renderer already accepts staged `files`; catalog examples need a way to
    declare assets and load them with the main scene.
  - Keep multi-file examples out of Pages/featured sets until lazy loading and
    deploy profiles are in place.
  - Acceptance: a catalog example can declare a main file plus supporting files
    and load through the same scene-selection path.
  - Touchpoints: `web/asset-drop.js`, `web/ui.js`, `wrapper/src/index.ts`,
    future catalog manifest.

- [ ] Separate curation flags.
  - Distinguish compact dropdown, gallery featured, Pages eligibility, Vercel
    eligibility, and ranking.
  - Acceptance: the dropdown can stay small while the full gallery grows.
  - Touchpoints: `FEATURED_EXAMPLE_NAMES`, example schema tests, gallery filters.

- [ ] Add tiered thumbnail assets.
  - Small list thumbnails, optional larger focused previews, and optional
    Vercel-only high-res assets.
  - Acceptance: Pages can ship small thumbnails while Vercel can expose richer
    previews from the same catalog metadata.
  - Touchpoints: `web/example-thumbnails/`, thumbnail generator, thumbnail tests.

## Deployment and persistence

- [ ] Add deploy profiles: Pages lean, Vercel full.
  - Use one assembly path with `--profile pages|vercel`.
  - Pages should stay small and static; Vercel can include the expanded archive.
  - Acceptance: `_site` contents and size budgets differ intentionally by
    profile, and both profiles are testable locally.
  - Touchpoints: `tools/assemble-site.mjs`, `.github/workflows/pages.yml`,
    `vercel.json`.

- [ ] Add site size and catalog safety gates.
  - Gate `_site` size by profile, thumbnail totals, manifest size, initial JS
    payload, missing attribution, and missing multi-file assets.
  - Acceptance: accidental 600 MB deploys fail before publish.
  - Touchpoints: new node tests around assembled output and catalog metadata.

- [ ] Keep short-link architecture ready without requiring a backend.
  - Static `#` permalinks and `?example=` links stay first-class.
  - Future `/x/:slug` should resolve through a narrow loader seam, with Vercel
    storage optional.
  - Acceptance: boot precedence is explicit and covered: hash, `/x` or `?x`,
    gist, example, local/default.
  - Touchpoints: `vercel.json`, `web/permalink.js`, `web/ui.js`.

- [ ] Add optional server-backed publish flow.
  - Keep local-first editing and hash permalinks as fallbacks.
  - Store the same scene-state shape used by the current permalink path, then
    add `/api/scenes` and `/x/<id>` only when storage is configured.
  - Acceptance: Copy Link can publish when storage exists and fall back to hash
    links when it does not.
  - Touchpoints: new scene-store client, Vercel API routes, `web/ui.js` copy-link
    flow.

## Architecture and maintainability

- [ ] Fix the god objects.
  - Now just `web/ui.js` (~3.4k lines, ~167 functions). `test/browser/ui.test.mjs`
    is done: it is an 84-line delegator over six drivers in `test/browser/ui/`.
  - Turbo is no longer the outlier it was. Its ~5.7k lines of app code now live in
    `web/turbo-app.js`, which eslint and checkJs both cover, and
    `tools/gen-turbo.mjs` inlines it into `web/turbo.html` between `gen:app`
    markers so the shipped page stays one self-contained file that runs from
    `file://` (it still cannot `import` ESM at runtime). The extraction alone
    surfaced eight latent problems, including 1,870 lines of `Parser` methods that
    were invisible to the type checker behind `Object.assign(Parser.prototype)`.
    It is held out of the 100% COVERAGE gate only, via the named, argued
    `COVERAGE_EXEMPT` allowlist in `test/node/coverage-config.test.mjs`.
  - Split only along stable seams: gallery/catalog UI, live preview/render
    orchestration, editor/source state, sharing/permalinks, and focused browser
    test drivers.
  - Acceptance: extracted modules have narrow contracts and are covered by
    behavior-preserving tests before any logic is moved.

- [x] Extract gallery/catalog UI once lazy rendering is started.
  - Keep DOM state, filters, selected example, and card rendering out of the
    top-level UI file.
  - Acceptance: gallery behavior is still covered by browser tests and the main
    UI module no longer owns gallery rendering internals.

- [x] Extract live preview/render orchestration.
  - Separate source-change decisions, draft policy, cancellation, and status text
    from button/event wiring.
  - Acceptance: draft policy can be tested without launching the full UI.
  - Done as `web/render-orchestrator.js` (routing verdicts + status text) and
    `web/live-draft.js` (draft policy), both covered by Node tests.

- [ ] Extract editor/source state. (Three of four concepts done, see below.)
  - Separate "loaded example", "current source", "dirty from loaded source", and
    "dirty from last render" into a small state model.
  - Acceptance: permalink, render, and dirty-state tests use the same model.
  - `web/scene-state.js` covers three of the four: loaded example, dirty from
    loaded source, plus the stash and gist baselines. "Current source" stays in
    the textarea on purpose (the DOM is the single source of truth; callers pass
    it in). "Dirty from last render" is still unmodelled, which is the same gap
    as "Distinguish modified-from-example from edited-since-render" above.

- [x] Split browser tests by feature area.
  - Break `test/browser/ui.test.mjs` into focused drivers/specs once feature
    seams exist.
  - Acceptance: coverage stays at 100% without one giant test file carrying the
    whole app.
  - Done: `ui.test.mjs` is an 84-line delegator over `test/browser/ui/`
    (harness, startup-render, catalog-editor, playback-drafts, deep-links,
    editor-tools, output-mobile).

- [ ] Keep any refactor behavior-preserving and test-first.
  - The coverage gate is useful but expensive; avoid churn that requires
    re-proving unrelated behavior.
  - Prefer extracting pure helpers and DOM controllers with narrow contracts.

- [ ] Avoid adding backend complexity before the static seams exist.
  - Catalog lazy loading, deploy profiles, and short-link loader boundaries should
    come before storage/provider-specific work.

## Research parking lot

These are interesting, but should not block the ready queue.

- [ ] Evaluate a separate draft wasm build with fewer worker threads.
- [ ] Evaluate reusable renderer instances only if startup remains a measured
      bottleneck after prewarming.
- [ ] Evaluate workerized GIF/APNG export if animation export becomes a real
      workflow.
- [ ] Evaluate pbrt-v4 as a future backend only after catalog, storage, and
      render orchestration seams are stable.
