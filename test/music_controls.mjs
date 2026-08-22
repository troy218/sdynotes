import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync(new URL('../sdynotes.html', import.meta.url), 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', error => {
  // Network-only failures are expected: this is a browser UI unit test.
  if (!/Could not load (script|link|style)/.test(error.message)) errors.push(error);
});

const dom = new JSDOM(html, {
  url: 'http://sdynotes.test/',
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.fetch = async () => new Response(JSON.stringify({ tracks: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
    window.confirm = () => false;
    window.prompt = () => null;
    window.alert = () => {};
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    window.IntersectionObserver = class { observe() {} disconnect() {} };
    window.ResizeObserver = class { observe() {} disconnect() {} };
    window.HTMLCanvasElement.prototype.getContext = () => ({
      setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {},
      stroke() {}, moveTo() {}, lineTo() {}, save() {}, restore() {}, translate() {},
      scale() {}, rotate() {}, fillText() {},
    });
    window.HTMLElement.prototype.scrollTo = function scrollTo(options) {
      this.scrollTop = (typeof options === 'object' ? options.top : options) || 0;
    };
    window.HTMLMediaElement.prototype.play = function play() {
      this.dispatchEvent(new window.Event('play'));
      return Promise.resolve();
    };
    window.HTMLMediaElement.prototype.pause = function pause() {
      this.dispatchEvent(new window.Event('pause'));
    };
    window.HTMLMediaElement.prototype.load = function load() {};
  },
});

await new Promise(resolve => setTimeout(resolve, 300));
const { window } = dom;
const { document } = window;
assert.equal(errors.length, 0, errors.map(error => error.stack).join('\n'));
assert.ok(window.sdyMusic, 'music module should initialize');

// Every visible, fixed music action has a listener. Dynamic track/context-menu
// actions are delegated and are covered by the music module initialization above.
const actionIds = [
  'mpBRefresh', 'mpBX', 'mpBShuf', 'mpBPrev', 'mpBPP', 'mpBNext', 'mpBRep', 'mpBRate',
  'mpBTabD', 'mpBTabQ', 'mpBTabA', 'mpBTabL', 'mpBTabY', 'mpBFind', 'mpBUp',
  'mpBSearchX', 'mpBPgPrev', 'mpBPgNext',
  'mpTagX', 'mpTagUrlBtn', 'mpTagCoverPick', 'mpTagCoverFind', 'mpTagCoverReset',
  'mpTagAuto', 'mpTagSyncLrc', 'mpTagRecog', 'mpTagOrigBtn', 'mpTagSave',
  'mpAddX', 'mpAddFile', 'mpYtGo', 'mpYtCookies', 'mpYtCookiesDel',
  'mpPrev', 'mpPP', 'mpNext', 'mpList', 'mpMore', 'mpExpand', 'mpPrev2', 'mpNext2',
  'mpRep', 'mpShuf', 'mpRate', 'mpVol', 'mpUp', 'mpDel', 'mpX',
  'mpTabAll', 'mpTabArt', 'mpTabPL', 'mpAddPL', 'mpPgPrev', 'mpPgNext', 'mpReopen',
];
for (const id of actionIds) {
  const element = document.getElementById(id);
  assert.ok(element, `${id} should exist`);
  assert.equal(typeof element.onclick, 'function', `${id} should have a click handler`);
}

// The artist label explicitly promises to show the current artist. Verify it
// filters the artist tab, and the artist tab button clears that temporary filter.
const state = window.sdyMusic._state();
state.list = [
  { id: 'artist-a-1', title: 'A one', artist: 'Artist A' },
  { id: 'artist-a-2', title: 'A two', artist: 'Artist A' },
  { id: 'artist-b-1', title: 'B one', artist: 'Artist B' },
];
window.sdyMusic.play(0);
window.sdyMusic.big();
document.getElementById('mpBArtist').click();
assert.equal(state.bigTab, 'a');
assert.equal(state.bigArtist, 'Artist A');
assert.match(document.getElementById('mpBBody').textContent, /A one/);
assert.doesNotMatch(document.getElementById('mpBBody').textContent, /B one/);
document.getElementById('mpBTabA').click();
assert.equal(state.bigArtist, '');
assert.match(document.getElementById('mpBBody').textContent, /B one/);

dom.window.close();
console.log(`Music controls: ${actionIds.length} fixed actions wired; artist filter verified.`);
