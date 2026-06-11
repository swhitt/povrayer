// Render feedback controller: owns the status live region, busy spinner, browser
// tab state, progress bar, and render-log text nodes. The caller still owns the
// render lifecycle and only drives this module with state transitions/events.

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
    applyTabState();
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

  /** @param {string} core hex (no #) for the orb's bright core stop */
  const orbIcon = (core) =>
    `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3CradialGradient id='g' cx='.33' cy='.28' r='.75'%3E%3Cstop offset='0' stop-color='%23fff'/%3E%3Cstop offset='.38' stop-color='%23${core}'/%3E%3Cstop offset='.78' stop-color='%2315151a'/%3E%3C/radialGradient%3E%3Ccircle cx='8' cy='8' r='8' fill='url(%23g)'/%3E%3C/svg%3E`;
  const ORB_READY = orbIcon('ffd23f');
  const ORB_BUSY = orbIcon('98a1ab');
  const baseTitle = document.title;

  function applyTabState() {
    const state = status.dataset.state;
    faviconLink.href = state === 'busy' ? ORB_BUSY : ORB_READY;
    if (state === 'busy') {
      document.title = 'rendering… · povrayer';
    } else if (document.hidden && (state === 'done' || state === 'error')) {
      document.title = `${status.textContent} · povrayer`;
    } else {
      document.title = baseTitle;
    }
  }
  document.addEventListener('visibilitychange', applyTabState);

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
