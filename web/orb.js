// The povrayer brand mark, in one place.
//
// The orb is a ray-traced sphere: a white specular core off-center at 33%/28%,
// the accent as the mid stop, and a near-black terminator. It is the only circle
// in the interface, and it has to exist in four places that share no runtime:
// two `<link rel="icon">` hrefs (parsed before any script runs), a CSS
// background on the wordmark span, and the favicon swap web/render-feedback.js
// performs while a render is in flight.
//
// So the DRAWING lives here, once, and every copy is byte-compared against it by
// test/node/chrome.test.mjs. That guard exists because the copies HAD drifted: the
// two favicons disagreed on the gradient radius (.75 vs .72), and the wordmark
// was not the same mark at all, a `circle farthest-corner` CSS gradient whose
// falloff computed about 31% larger than the SVG's. The favicon and the wordmark
// sit 16px apart at the same size, so that read as two different logos.
//
// Percent-encoding, not encodeURIComponent: the SVG is written with single-quoted
// attributes so only `<`, `>` and `#` actually need escaping, and the result has
// to stay legal in an HTML attribute, inside a CSS url("...") string, and in a
// `link.href =` assignment. Blanket-encoding would also eat the spaces and
// slashes, which all three contexts accept literally and which keep the URI
// short enough to read in a diff.

/** The bright core stop of the resting orb: --accent (#ffd23f) in web/styles.css. */
export const ORB_CORE = 'ffd23f';

/** The core stop while a render is in flight: --dim (#98a1ab) in web/styles.css. */
export const ORB_BUSY_CORE = '98a1ab';

/** The three characters a data: URI cannot carry literally in these contexts. */
const URI_ESCAPES = { '<': '%3C', '>': '%3E', '#': '%23' };

/**
 * The orb as a standalone SVG document.
 * @param {string} core hex (no leading #) for the bright core stop
 * @returns {string}
 */
export function orbSvg(core) {
  return (
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'>" +
    "<radialGradient id='g' cx='.33' cy='.28' r='.75'>" +
    "<stop offset='0' stop-color='#fff'/>" +
    `<stop offset='.38' stop-color='#${core}'/>` +
    "<stop offset='.78' stop-color='#15151a'/>" +
    '</radialGradient>' +
    "<circle cx='8' cy='8' r='8' fill='url(#g)'/>" +
    '</svg>'
  );
}

/**
 * The same orb as a `data:image/svg+xml` URI, ready for an icon href, a CSS
 * url("...") or an img src.
 * @param {string} core hex (no leading #) for the bright core stop
 * @returns {string}
 */
export function orbDataUri(core) {
  return (
    'data:image/svg+xml,' +
    orbSvg(core).replace(/[<>#]/g, (c) => URI_ESCAPES[/** @type {'<'} */ (c)])
  );
}
