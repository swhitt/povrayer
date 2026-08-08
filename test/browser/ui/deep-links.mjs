import assert from 'node:assert/strict';
import { encodeState } from '../../../web/permalink.js';

export async function runDeepLinks(ctx) {
  const { page, server, selAdvanced, editorValue } = ctx;

  // ===========================================================================
  // Gist deep-link (?gist=<id>): load a scene from a GitHub gist on page init,
  // OVERRIDING the restored scene. The gist JSON API is page.route-mocked so the
  // test is fully deterministic and never touches the real network. Covers a
  // successful .pov load + render, the user/id + full-URL leniency, a no-.pov
  // first-file fallback, and the graceful failure modes (no usable text file,
  // HTTP error, network failure, malformed id) that each fall back to the saved
  // scene with a quiet inline message and strip the param from the URL.
  // ===========================================================================
  const GIST_POV = [
    '#version 3.8;',
    'global_settings { assumed_gamma 1.0 }',
    'camera { location <0,0,-4> look_at 0 }',
    'light_source { <2,4,-3> rgb 1 }',
    'sphere { 0, 1 pigment { rgb <0,1,0> } } // from a gist .pov file',
    '',
  ].join('\n');
  const GIST_TXT = GIST_POV.replace('.pov file', '.txt file (no .pov present)');
  const FALLBACK_SCENE = '// saved fallback scene\nsphere { 0, 1 }\n';

  // Mock the gist JSON API, keyed on the hex id in the request URL. Every
  // fulfilled response carries Access-Control-Allow-Origin so the cross-origin
  // CORS fetch is readable under COEP (faithful to the real api.github.com,
  // which sends `*`); an unknown id 404s the same readable way.
  await page.route('https://api.github.com/gists/*', async (route) => {
    const id = route.request().url().split('/').pop();
    if (id === 'face') return route.abort(); // simulate a network failure
    const json = (obj) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(obj),
      });
    if (id === 'abc1')
      return json({ files: { 'scene.pov': { filename: 'scene.pov', content: GIST_POV } } });
    if (id === 'beef')
      return json({ files: { 'scene.txt': { filename: 'scene.txt', content: GIST_TXT } } });
    if (id === 'cafe')
      // a single file with no inline content (truncated) -> nothing usable
      return json({ files: { 'big.pov': { filename: 'big.pov', truncated: true } } });
    return route.fulfill({
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Not Found' }),
    });
  });

  // Seed a clean, known state for every gist navigation: live-draft ON (so a
  // successful load actually previews) and a distinct saved source that doubles
  // as the failure fallback. addInitScript stacks and runs last, so it wins over
  // any blob a prior section seeded, on each goto below.
  await page.addInitScript((fallback) => {
    localStorage.clear();
    localStorage.setItem('povrayer.ui.v1', JSON.stringify({ source: fallback, liveDraft: true }));
  }, FALLBACK_SCENE);

  const gistGoto = async (query) => {
    await page.goto(server.url + query, { waitUntil: 'load' });
    await page.waitForFunction(
      () => document.querySelectorAll('#example-listbox .ex-option').length >= 4,
      null,
      { timeout: 30_000 }
    );
  };
  const editorIs = (text, t = 10_000) =>
    page.waitForFunction((v) => document.getElementById('editor').value === v, text, {
      timeout: t,
    });
  const searchHasGist = () => page.evaluate(() => /gist/.test(location.search));

  // Success (bare id): the gist .pov overrides the restored scene, the ?gist
  // param STAYS as the shareable permalink (not stripped), no error shows, and it
  // renders in FULL (not a draft): the output settles at the full 512px width,
  // not the draft's 320px downscale.
  await gistGoto('?gist=abc1');
  await editorIs(GIST_POV);
  await page.waitForFunction(
    () => {
      const o = document.getElementById('output');
      return o.src.startsWith('blob:') && o.naturalWidth === 512;
    },
    null,
    { timeout: 120_000 }
  );
  assert.equal(
    await searchHasGist(),
    true,
    'a successful gist load keeps ?gist as the shareable permalink'
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('error').hidden),
    true,
    'a successful gist load surfaces no error'
  );

  // Pinned permalink: while the gist scene is unmodified, Copy Link copies the
  // short ?gist URL (not a compressed #hash), and the bar keeps ?gist with no hash.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('#copy-link-btn');
  await page.waitForFunction(() => window.__permalinkProbe().label === 'Copied', null, {
    timeout: 5_000,
  });
  const pinnedCopied = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(
    pinnedCopied,
    /[?&]gist=abc1\b/,
    'Copy Link copies the short ?gist URL while pinned'
  );
  assert.equal(pinnedCopied.includes('#'), false, 'the pinned copy carries no #hash');
  const pinnedBar = await page.evaluate(() => ({ search: location.search, hash: location.hash }));
  assert.match(pinnedBar.search, /(^|[?&])gist=abc1\b/, 'an unmodified gist stays pinned to ?gist');
  assert.equal(pinnedBar.hash, '', 'a pinned gist carries no #hash');

  // Editing the gist scene unpins: the URL drops ?gist but does not ambiently
  // mint a self-contained #hash. Copy Link is the explicit hash action.
  await page.fill('#editor', GIST_POV + '\n// edited away from the gist\n');
  await page.waitForFunction(() => !/gist=/.test(location.search), null, { timeout: 5_000 });
  const unpinned = await page.evaluate(() => ({ search: location.search, hash: location.hash }));
  assert.equal(/gist=/.test(unpinned.search), false, 'editing a pinned gist drops ?gist');
  assert.equal(unpinned.hash, '', 'editing a pinned gist leaves the hash clean');

  // Leniency: a `user/id` and a full gist URL both resolve to the same id, so
  // they hit the same success path (the gist .pov lands in the editor).
  await gistGoto('?gist=octocat%2Fabc1');
  await editorIs(GIST_POV);
  await gistGoto('?gist=' + encodeURIComponent('https://gist.github.com/octocat/abc1'));
  await editorIs(GIST_POV);

  // No-.pov fallback: a gist whose only file isn't a .pov still loads (the first
  // text file), so the editor gets that file's content.
  await gistGoto('?gist=beef');
  await editorIs(GIST_TXT);

  // Graceful failures: each shows a quiet inline message, keeps the saved
  // fallback scene in the editor, and strips the param. Shared assertions, with
  // a per-case message match.
  const gistFailure = async (query, pattern) => {
    await gistGoto(query);
    await page.waitForFunction(() => !document.getElementById('error').hidden, null, {
      timeout: 15_000,
    });
    assert.match(
      await page.evaluate(() => document.getElementById('error').textContent),
      pattern,
      `gist failure message for ${query}`
    );
    assert.equal(
      await page.evaluate(() => document.getElementById('editor').value),
      FALLBACK_SCENE,
      `${query} falls back to the saved scene`
    );
    // Quiet, non-modal: a polite role=status, draft-styled box (never the loud
    // role=alert a user-triggered Render uses).
    assert.deepEqual(
      await page.evaluate(() => {
        const e = document.getElementById('error');
        return { role: e.getAttribute('role'), draft: e.classList.contains('draft') };
      }),
      { role: 'status', draft: true },
      `${query} reads as a quiet role=status, draft-styled box`
    );
    assert.equal(await searchHasGist(), false, `${query} strips ?gist from the URL`);
  };
  await gistFailure('?gist=cafe', /no scene file/); // a gist with no usable text file
  await gistFailure('?gist=dead404', /HTTP 404/); // a 404 from the API
  await gistFailure('?gist=face', /reach the gist API/); // a network failure (route.abort)
  await gistFailure('?gist=nothex', /read a gist id/); // a malformed id (parsed, never fetched)

  await page.unroute('https://api.github.com/gists/*');

  // ===========================================================================
  // Shareable permalink (#<payload>): the Copy Link button compresses the scene
  // + settings into a base64url hash, copies a shareable URL to the clipboard,
  // and reflects the hash in the address bar. A page opened with such a hash
  // hydrates the editor + controls (overriding the restored scene), tolerates a
  // garbage hash (falling through to ?gist then cold-load), and ignores select
  // values the markup doesn't offer. The gist API is page.route-mocked so the
  // junk-hash-falls-through-to-gist case stays deterministic.
  // ===========================================================================
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

  // A known per-load fallback so a hash/gist override is unambiguous against it.
  const PL_FALLBACK = '// permalink fallback scene\nsphere { 0, 1 }\n';
  await page.addInitScript((fallback) => {
    localStorage.clear();
    localStorage.setItem('povrayer.ui.v1', JSON.stringify({ source: fallback, liveDraft: true }));
  }, PL_FALLBACK);

  const PL_GIST = '#version 3.8;\n// FROM GIST permalink test\nbox {}\n';
  await page.route('https://api.github.com/gists/*', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ files: { 's.pov': { filename: 's.pov', content: PL_GIST } } }),
    })
  );

  // page.goto to a URL that differs from the current one ONLY in its hash is an
  // in-page fragment change, not a reload, so the permalink init never re-runs.
  // A unique throwaway ?pl=<n> search (the init code ignores any param but
  // ?gist) forces a full document load every time without bouncing through
  // about:blank, which would drop the page's accumulated V8 coverage.
  let plNav = 0;
  const plBootGoto = async (search, hash = '') => {
    const sep = search ? '&' : '?';
    await page.goto(`${server.url}${search}${sep}pl=${plNav++}${hash}`, { waitUntil: 'load' });
    await page.waitForFunction(
      () => document.querySelectorAll('#example-listbox .ex-option').length >= 4,
      null,
      { timeout: 30_000 }
    );
  };
  const ctlValue = (id) => page.evaluate((i) => document.getElementById(i).value, id);
  const bodyMode = () => page.evaluate(() => document.body.dataset.mode);
  const aria = (id) =>
    page.evaluate((i) => document.getElementById(i).getAttribute('aria-pressed'), id);

  // --- Case 1: Copy Link writes a decodable permalink, sets the hash, flips the
  // label, then reverts it. ---------------------------------------------------
  await plBootGoto('');
  await page.fill('#width', '321');
  await page.fill('#height', '258');
  await selAdvanced('#quality', '4');
  await selAdvanced('#antialias', '0.3');
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.value = '#version 3.8;\n// permalink copy test\nsphere { 0, 1 }';
    ed.dispatchEvent(new Event('input'));
  });
  await page.click('#copy-link-btn');
  await page.waitForFunction(() => window.__permalinkProbe().label === 'Copied', null, {
    timeout: 10_000,
  });
  await page.waitForFunction(() => window.__permalinkProbe().hash.length > 1, null, {
    timeout: 10_000,
  });
  const copiedUrl = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(
    copiedUrl.startsWith((await page.evaluate(() => location.origin + location.pathname)) + '#'),
    'the copied URL is origin + pathname + #<payload>'
  );
  const decoded = await page.evaluate(async (u) => {
    const { decodeState } = await import('./permalink.js');
    return decodeState(new URL(u).hash.slice(1));
  }, copiedUrl);
  assert.equal(decoded.width, '321', 'permalink round-trips width');
  assert.equal(decoded.height, '258', 'permalink round-trips height');
  assert.equal(decoded.quality, '4', 'permalink round-trips quality');
  assert.equal(decoded.antialias, '0.3', 'permalink round-trips antialias');
  assert.equal(decoded.mode, 'still', 'permalink round-trips the still mode');
  assert.match(decoded.source, /permalink copy test/, 'permalink round-trips the scene source');
  // The label reverts to "Copy Link" once the setTimeout fires.
  await page.waitForFunction(() => window.__permalinkProbe().label === 'Copy Link', null, {
    timeout: 4_000,
  });

  // --- Case 2: a still-mode permalink hash hydrates editor + controls. --------
  const stillPayload = await encodeState({
    source: '#version 3.8;\n// HYDRATED still\nbox {}',
    width: '200',
    height: '160',
    quality: '2',
    antialias: 'off',
    threads: '3',
    flags: '+A0.05 +AM2',
    mode: 'still',
    frames: '10',
    fps: '8',
  });
  await plBootGoto('', '#' + stillPayload);
  assert.match(await editorValue(), /HYDRATED still/, 'a permalink hash hydrates the editor');
  assert.equal(await ctlValue('width'), '200', 'permalink hydrates width');
  assert.equal(await ctlValue('height'), '160', 'permalink hydrates height');
  assert.equal(await ctlValue('quality'), '2', 'permalink hydrates quality');
  assert.equal(await ctlValue('antialias'), 'off', 'permalink hydrates antialias');
  assert.equal(await ctlValue('threads'), '3', 'permalink hydrates threads');
  assert.equal(await ctlValue('flags'), '+A0.05 +AM2', 'permalink hydrates raw flags');
  assert.equal(await ctlValue('frames'), '10', 'permalink hydrates frames');
  assert.equal(await ctlValue('fps'), '8', 'permalink hydrates fps');
  assert.equal(await bodyMode(), 'still', 'permalink hydrates still mode');
  assert.equal(await aria('mode-still'), 'true', 'still toggle reflects pressed');

  // --- Case 3: pristine catalog examples use short ?example links. ------------
  await plBootGoto('?example=sourced-wineglass&width=333&height=222&q=5&mode=still');
  await page.waitForFunction(
    () => document.getElementById('example-trigger').dataset.name === 'sourced-wineglass',
    null,
    { timeout: 10_000 }
  );
  // A still ?example= link is a "show me this scene" deep link with the ?gist
  // contract: the recipient lands on the finished FULL render at the link's
  // settings (download offered), not a draft or an empty plate.
  await page.waitForFunction(
    () => document.getElementById('status').dataset.state === 'done',
    null,
    { timeout: 120_000 }
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('download-btn').hidden),
    false,
    'a still ?example link lands on a finished full render'
  );
  assert.match(
    await editorValue(),
    /wineglass\.pov/i,
    'the ?example route hydrates the catalog source'
  );
  assert.equal(await ctlValue('width'), '333', 'the ?example route carries render params');
  assert.equal(await ctlValue('height'), '222', 'the ?example route carries height');
  await page.click('#copy-link-btn');
  await page.waitForFunction(() => window.__permalinkProbe().label === 'Copied', null, {
    timeout: 10_000,
  });
  const exampleCopied = await page.evaluate(() => navigator.clipboard.readText());
  // The test server has the /e/ redirect layer (like vercel.json in
  // production), so pristine examples copy as the pretty short-link form with
  // the render params riding along as ordinary query params.
  assert.equal(
    new URL(exampleCopied).pathname,
    '/e/sourced-wineglass',
    'pristine examples copy as /e/ short links on redirect-capable hosts'
  );
  assert.equal(
    new URL(exampleCopied).searchParams.get('width'),
    '333',
    'an /e/ short link carries the render params'
  );
  assert.equal(
    new URL(exampleCopied).searchParams.has('example'),
    false,
    'the /e/ form drops the redundant ?example param'
  );
  assert.equal(new URL(exampleCopied).hash, '', 'a pristine example copy carries no scene hash');

  // Copy Link surfaced the /e/ path in the address bar; an edit makes the
  // scene custom, so the next debounced save re-anchors the address at the
  // root (the syncAddressUrl /e/ arm + the baseSceneUrl strip).
  assert.equal(
    await page.evaluate(() => location.pathname),
    '/e/sourced-wineglass',
    'Copy Link reflects the short link in the address bar'
  );
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.value += '\n// edited past the short link\n';
    ed.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => location.pathname === '/', null, { timeout: 10_000 });

  await plBootGoto('?example=orbit-moons');
  await page.waitForFunction(
    () => document.getElementById('example-trigger').dataset.name === 'orbit-moons',
    null,
    { timeout: 10_000 }
  );
  await page.waitForTimeout(600);
  assert.deepEqual(
    await page.evaluate(() => ({
      mode: document.body.dataset.mode,
      frames: document.getElementById('frames').value,
      fps: document.getElementById('fps').value,
      pending: window.__liveDraftProbe().pending,
      inFlight: window.__liveDraftProbe().inFlight,
    })),
    { mode: 'still', frames: '24', fps: '24', pending: false, inFlight: false },
    'animated ?example links prepare frames/fps but wait for explicit Render'
  );

  // An example link that lands in animate mode never auto-renders either (a
  // full frame sweep is too big to fire unasked): the boot router falls
  // through to the draft path, which animate mode also gates off.
  await plBootGoto('?example=sourced-wineglass&mode=animate');
  await page.waitForFunction(() => document.body.dataset.mode === 'animate', null, {
    timeout: 10_000,
  });
  assert.equal(
    await page.evaluate(async () => (await import('/render-client.js')).isBusy()),
    false,
    'an animate-mode example link must not auto-render'
  );

  // --- Case 4: an animate-mode permalink hydrates mode + player fps. ----------
  const animPayload = await encodeState({
    source: '#version 3.8;\n// HYDRATED animate\nbox {}',
    width: '256',
    height: '256',
    quality: '',
    antialias: '0.1',
    threads: '',
    mode: 'animate',
    frames: '48',
    fps: '30',
  });
  await plBootGoto('', '#' + animPayload);
  assert.match(await editorValue(), /HYDRATED animate/, 'an animate permalink hydrates the editor');
  assert.equal(await bodyMode(), 'animate', 'permalink hydrates animate mode');
  assert.equal(await aria('mode-animate'), 'true', 'animate toggle reflects pressed');
  assert.equal(await ctlValue('fps'), '30', 'permalink hydrates fps in animate');
  assert.match(
    await page.evaluate(() => document.getElementById('frame-readout').textContent),
    /30 fps/,
    'player.setFps reflects the hydrated fps in the merged readout'
  );
  // A live draft never fires in animate (scheduleDraft self-guards to still).
  assert.equal(
    await page.evaluate(() => window.__liveDraftProbe().pending),
    false,
    'no live draft schedules in an animate permalink'
  );

  // --- Case 5: a garbage hash WITH ?gist falls through to the gist load. ------
  await plBootGoto('?gist=abc123', '#%%%not-base64%%%');
  await page.waitForFunction((v) => document.getElementById('editor').value === v, PL_GIST, {
    timeout: 10_000,
  });
  assert.match(await editorValue(), /FROM GIST/, 'a junk hash falls through to the gist load');

  // --- Case 6: out-of-range select values in the payload are ignored. ---------
  const bogusSelects = await encodeState({
    source: '#version 3.8;\n// bogus selects\nbox {}',
    width: '512',
    height: '384',
    quality: '42', // not a real option
    antialias: '9.9', // not a real option
    threads: '',
    mode: 'still',
    frames: '24',
    fps: '12',
  });
  await plBootGoto('', '#' + bogusSelects);
  assert.match(
    await editorValue(),
    /bogus selects/,
    'the bogus-select payload still hydrates source'
  );
  assert.equal(
    await ctlValue('quality'),
    '9',
    'an out-of-range quality keeps the default option (guard false arm)'
  );
  assert.equal(
    await ctlValue('antialias'),
    '0.1',
    'an out-of-range antialias keeps the default option (guard false arm)'
  );

  // --- Case 7: a garbage hash with NO gist cold-loads the restored scene. -----
  await plBootGoto('', '#zzzz');
  await page.waitForFunction((v) => document.getElementById('editor').value === v, PL_FALLBACK, {
    timeout: 10_000,
  });
  await page.waitForFunction(
    () => window.__liveDraftProbe().pending || window.__liveDraftProbe().inFlight,
    null,
    {
      timeout: 10_000,
    }
  );

  // --- Case 8: the address bar stays clean until Copy Link. -------------------
  // A cold load leaves the hash clean; editing a scene persists local state but
  // does not keep rewriting the visible URL with a full scene payload.
  await plBootGoto('');
  assert.equal(
    await page.evaluate(() => location.hash),
    '',
    'a cold load leaves the URL hash clean until the first change'
  );
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.value = '#version 3.8;\n// LIVE SYNC scene\nsphere { 0, 2 }';
    ed.dispatchEvent(new Event('input'));
  });
  await page.waitForTimeout(600);
  const cleanEditUrl = await page.evaluate(() => ({
    search: location.search,
    hash: location.hash,
  }));
  assert.match(cleanEditUrl.search, /^\?pl=\d+$/, 'the test boot query may remain');
  assert.equal(
    cleanEditUrl.hash,
    '',
    'ordinary editing leaves the visible URL free of scene payloads'
  );

  // ===========================================================================
  // URL query params (?width=...&q=...&mode=...): seed the controls on load.
  // Valid values land on the controls; unknown select values are ignored,
  // keeping the default option.
  // ===========================================================================
  await plBootGoto(
    '?width=1024&height=768&threads=4&frames=30&fps=20&quality=5&antialias=0.3&flags=%2BAM2&mode=animate'
  );
  assert.equal(await ctlValue('width'), '1024', 'url param sets width');
  assert.equal(await ctlValue('height'), '768', 'url param sets height');
  assert.equal(await ctlValue('threads'), '4', 'url param sets threads');
  assert.equal(await ctlValue('frames'), '30', 'url param sets frames');
  assert.equal(await ctlValue('fps'), '20', 'url param sets fps');
  assert.equal(await ctlValue('quality'), '5', 'url param sets a valid quality option');
  assert.equal(await ctlValue('antialias'), '0.3', 'url param sets a valid antialias option');
  assert.equal(await ctlValue('flags'), '+AM2', 'url param sets the raw flags field');
  assert.equal(await bodyMode(), 'animate', 'url param sets animate mode');

  // Unknown select values are ignored (kept at default); mode=still covers the
  // other mode arm.
  await plBootGoto('?quality=999&antialias=bogus&mode=still');
  assert.equal(await ctlValue('quality'), '9', 'an unknown quality param keeps the default option');
  assert.equal(
    await ctlValue('antialias'),
    '0.1',
    'an unknown antialias param keeps the default option'
  );
  assert.equal(await bodyMode(), 'still', 'url param sets still mode');

  await page.unroute('https://api.github.com/gists/*');
}
