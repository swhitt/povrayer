// Unit tests for web/url-params.js: the pure query-param parser ui.js uses to
// seed the controls from a deep link. Exhaustive so the module hits 100% without
// needing a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseRenderParams } from '../../web/url-params.js';

test('empty / no params yields an empty object', () => {
  assert.deepEqual(parseRenderParams(''), {});
  assert.deepEqual(parseRenderParams('?'), {});
  assert.deepEqual(parseRenderParams('?unrelated=1&gist=abc'), {});
});

test('full names parse into the matching keys', () => {
  assert.deepEqual(
    parseRenderParams(
      '?width=800&height=600&quality=5&antialias=0.3&threads=4&frames=30&fps=20&mode=animate'
    ),
    {
      width: '800',
      height: '600',
      quality: '5',
      antialias: '0.3',
      threads: '4',
      frames: '30',
      fps: '20',
      mode: 'animate',
    }
  );
});

test('short aliases parse (w/h/q/aa/t)', () => {
  assert.deepEqual(parseRenderParams('?w=1024&h=768&q=3&aa=0.1&t=8'), {
    width: '1024',
    height: '768',
    quality: '3',
    antialias: '0.1',
    threads: '8',
  });
});

test('a full name wins over its alias when both are present', () => {
  assert.equal(parseRenderParams('?width=900&w=100').width, '900');
});

test('the leading ? is optional', () => {
  assert.deepEqual(parseRenderParams('width=512'), { width: '512' });
});

test('numeric params clamp to the control ranges', () => {
  assert.equal(parseRenderParams('?width=99999').width, '2048');
  assert.equal(parseRenderParams('?width=1').width, '8');
  assert.equal(parseRenderParams('?height=99999').height, '2048');
  assert.equal(parseRenderParams('?threads=999').threads, '32');
  assert.equal(parseRenderParams('?threads=0').threads, '1');
  assert.equal(parseRenderParams('?frames=99999').frames, '240');
  assert.equal(parseRenderParams('?fps=0').fps, '1');
});

test('non-numeric numeric params are dropped', () => {
  assert.deepEqual(parseRenderParams('?width=abc&height=&threads=x'), {});
});

test('quality/antialias pass through raw (validated against the DOM by the caller)', () => {
  // 999 is not a real option value; the module still returns it and ui.js drops
  // it when it does not match a <select> option.
  assert.equal(parseRenderParams('?quality=999').quality, '999');
  assert.equal(parseRenderParams('?antialias=bogus').antialias, 'bogus');
  assert.equal(parseRenderParams('?antialias=off').antialias, 'off');
});

test('mode only accepts still | animate', () => {
  assert.equal(parseRenderParams('?mode=still').mode, 'still');
  assert.equal(parseRenderParams('?mode=animate').mode, 'animate');
  assert.equal(parseRenderParams('?mode=spin').mode, undefined);
  assert.equal('mode' in parseRenderParams('?mode=spin'), false);
});

test('flags pass through raw', () => {
  assert.equal(parseRenderParams('?flags=%2BA0.05+%2BAM2').flags, '+A0.05 +AM2');
  assert.equal('flags' in parseRenderParams('?width=8'), false);
});

test('draft passes through raw (validated against the select by the caller)', () => {
  assert.equal(parseRenderParams('?draft=256').draft, '256');
  assert.equal(parseRenderParams('?draft=999').draft, '999'); // dropped later by ui.js
  assert.equal('draft' in parseRenderParams('?width=8'), false);
});
