export function createUiHarness({ server, browser, page }) {
  // quality/antialias/threads live in the collapsed "advanced" disclosure; using
  // them means expanding it first (as a user would). These wrappers open advanced
  // before each interaction so the steps stay robust across the reloads below that
  // reset the disclosure to its saved/default state.
  const openAdvanced = () => page.evaluate(() => (document.getElementById('advanced').open = true));
  const selAdvanced = async (sel, val) => {
    await openAdvanced();
    await page.selectOption(sel, val);
  };
  const fillAdvanced = async (sel, val) => {
    await openAdvanced();
    await page.fill(sel, val);
  };
  // Set the editor source and fire the input event the app listens on (rebuilds
  // the scene-params panel, schedules a save/draft). Shared by the slider steps.
  const setSceneSource = (val) =>
    page.evaluate(async (v) => {
      const e = document.getElementById('editor');
      e.value = v;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(requestAnimationFrame);
    }, val);

  return {
    server,
    browser,
    page,
    openAdvanced,
    selAdvanced,
    fillAdvanced,
    setSceneSource,
  };
}
