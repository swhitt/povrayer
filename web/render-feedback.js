// Render feedback controller: owns the status live region, busy spinner, browser
// tab state, progress bar, and render-log text nodes. The caller still owns the
// render lifecycle and only drives this module with state transitions/events.
import { ORB_CORE, ORB_BUSY_CORE, orbDataUri } from './orb.js';

/**
 * Browser-tab feedback: the favicon tint and the document title.
 *
 * Both surfaces use it, and only this part: web/ui.js through
 * createRenderFeedback below, web/repl.js on its own (that page has its own
 * status footer and progress bar, so the rest of this module would be dead
 * weight there). Hence module scope with no reference to the render-feedback
 * closure, reading the status element only through the two accessors: a page
 * needs a favicon <link> and a state/text pair to adopt it, nothing else.
 *
 * @param {{
 *   faviconLink: HTMLLinkElement,
 *   getState: () => string | undefined,
 *   getText: () => string | null,
 * }} deps
 * @returns {{ apply: () => void }}
 */
export function createTabState({ faviconLink, getState, getText }) {
  const ORB_READY = orbDataUri(ORB_CORE);
  const ORB_BUSY = orbDataUri(ORB_BUSY_CORE);
  const baseTitle = document.title;
  // The brand segment of whatever this page is called, so the transient titles
  // read "rendering… · povrayer" / "rendering… · povrayer repl" rather than
  // dragging each page's tagline along behind the state. Splitting on the two
  // separators the titles use (a comma or a middot) needs no per-page config and
  // cannot fail: split always yields at least one segment.
  const brand = baseTitle.split(/[,·]/)[0].trim();

  function apply() {
    const state = getState();
    faviconLink.href = state === 'busy' ? ORB_BUSY : ORB_READY;
    if (state === 'busy') {
      document.title = `rendering… · ${brand}`;
    } else if (document.hidden && (state === 'done' || state === 'error')) {
      // The payoff (or the failure) belongs in the tab strip when nobody is
      // looking at the page.
      document.title = `${getText()} · ${brand}`;
    } else {
      document.title = baseTitle;
    }
  }
  document.addEventListener('visibilitychange', apply);
  return { apply };
}

/**
 * @typedef {Object} RenderFeedbackElements
 * @property {HTMLElement} status
 * @property {HTMLElement} statusSpinner
 * @property {HTMLElement} stopBtn
 * @property {HTMLElement} progressBar
 * @property {HTMLElement} log
 * @property {HTMLElement} logDetails
 * @property {HTMLElement} logLabel
 * @property {HTMLElement} logCount
 * @property {HTMLLinkElement} faviconLink
 * @property {() => boolean} isDrafting
 */

/**
 * @param {RenderFeedbackElements} elements
 */
export function createRenderFeedback(elements) {
  const {
    status,
    statusSpinner,
    stopBtn,
    progressBar,
    log,
    logDetails,
    logLabel,
    logCount,
    faviconLink,
    isDrafting,
  } = elements;

  // Busy-phase text updates are throttled to one per second (live-region
  // hygiene); terminal states flush immediately and cancel any pending update.
  let statusTimer = null;
  let statusLastAt = 0;
  let statusPending = null;

  /** @param {string} text @param {string} state */
  function setStatus(text, state) {
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    statusPending = null;
    status.textContent = text;
    status.dataset.state = state;
    statusLastAt = performance.now();
    syncSpinner();
    tab.apply();
  }

  /** @param {string} text */
  function setBusyStatus(text) {
    status.dataset.state = 'busy';
    syncSpinner();
    const now = performance.now();
    if (now - statusLastAt >= 1000) {
      status.textContent = text;
      statusLastAt = now;
      return;
    }
    statusPending = text;
    if (!statusTimer) {
      statusTimer = setTimeout(
        () => {
          statusTimer = null;
          if (statusPending !== null) {
            status.textContent = statusPending;
            statusPending = null;
            statusLastAt = performance.now();
          }
        },
        1000 - (now - statusLastAt)
      );
    }
  }

  // The spinner mirrors "a render is actually in flight". An explicit render
  // holds data-state 'busy' for its whole duration; a live draft holds 'draft',
  // but that state also describes a settled draft, so the draft case keys on the
  // in-flight controller, not the state.
  function syncSpinner() {
    const inFlight = status.dataset.state === 'busy' || isDrafting();
    statusSpinner.hidden = !inFlight;
    stopBtn.hidden = !inFlight;
  }

  const tab = createTabState({
    faviconLink,
    getState: () => status.dataset.state,
    getText: () => status.textContent,
  });

  let progressPct = -1;
  let progressPrimed = false;

  function progressStart() {
    progressPct = -1;
    progressPrimed = false;
    progressBar.classList.add('indeterminate');
    progressBar.classList.remove('determinate');
    progressBar.style.removeProperty('--pct');
    progressBar.hidden = false;
  }

  /**
   * @param {number} p
   * @returns {number} the last confirmed determinate percent, or -1
   */
  function progressPercent(p) {
    if (!progressPrimed) {
      progressPrimed = true;
      return progressPct;
    }
    /* c8 ignore start -- the dist normally emits one progress burst per render, so a second percent (the determinate path) is not reliably reachable; ignored to keep the gate deterministic */
    if (!(p > progressPct)) return progressPct;
    progressPct = p;
    progressDeterminate(p);
    /* c8 ignore stop -- closes the ignore block opened above */
    return progressPct;
  }

  /** @param {number} pct */
  function progressDeterminate(pct) {
    progressBar.classList.remove('indeterminate');
    progressBar.classList.add('determinate');
    progressBar.style.setProperty('--pct', String(pct));
  }

  function progressStop() {
    progressBar.hidden = true;
    progressBar.classList.remove('indeterminate', 'determinate');
    progressBar.style.removeProperty('--pct');
    progressPct = -1;
    progressPrimed = false;
  }

  const logCommittedNode = document.createTextNode('');
  const logProgressNode = document.createTextNode('');
  log.append(logCommittedNode, logProgressNode);
  let logHasProgressLine = false;

  function logPinned() {
    return log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
  }

  /** @param {boolean} wasPinned */
  function refreshLogScroll(wasPinned) {
    if (wasPinned) log.scrollTop = log.scrollHeight;
    if (logDetails.hidden) logDetails.hidden = false;
  }

  /** @param {string} text */
  function appendLogLine(text) {
    const pinned = logPinned();
    if (logHasProgressLine) {
      logCommittedNode.appendData(logProgressNode.data + '\n');
      logProgressNode.data = '';
      logHasProgressLine = false;
    }
    logCommittedNode.appendData(text + '\n');
    refreshLogScroll(pinned);
  }

  /** @param {string} text */
  function setProgressLine(text) {
    const pinned = logPinned();
    logProgressNode.data = text;
    logHasProgressLine = true;
    refreshLogScroll(pinned);
  }

  function commitProgressLine() {
    /* c8 ignore start -- the shipped dist always emits render-statistics lines after the final progress event, so appendLogLine commits the pending progress line first; this standalone commit never sees one pending */
    if (logHasProgressLine) {
      const pinned = logPinned();
      logCommittedNode.appendData(logProgressNode.data + '\n');
      logProgressNode.data = '';
      logHasProgressLine = false;
      refreshLogScroll(pinned);
    }
    /* c8 ignore stop -- closes the ignore block opened above */
  }

  function resetLog() {
    logCommittedNode.data = '';
    logProgressNode.data = '';
    logHasProgressLine = false;
    setLogSummary('render log');
  }

  function logLineCount() {
    const text = log.textContent;
    return text ? text.replace(/\n+$/, '').split('\n').length : 0;
  }

  /** @param {string} label */
  function setLogSummary(label) {
    logLabel.textContent = label;
    const n = logLineCount();
    logCount.textContent = n ? `(${n} lines)` : '';
  }

  return {
    setStatus,
    setBusyStatus,
    syncSpinner,
    progressStart,
    progressPercent,
    progressDeterminate,
    progressStop,
    appendLogLine,
    setProgressLine,
    commitProgressLine,
    resetLog,
    setLogSummary,
  };
}
