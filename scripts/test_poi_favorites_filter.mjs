import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected ${name} to exist in index.html`);
  const parametersStart = source.indexOf('(', start);
  let parameterDepth = 0;
  let bodyStart = -1;
  for (let index = parametersStart; index < source.length; index += 1) {
    if (source[index] === '(') parameterDepth += 1;
    if (source[index] === ')') parameterDepth -= 1;
    if (parameterDepth === 0) {
      bodyStart = source.indexOf('{', index);
      break;
    }
  }
  assert.notEqual(bodyStart, -1, `Expected ${name} to have a function body`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name} from index.html`);
}

const poiVisibilityState = {
  hideModeActive: true,
  hideMultipleActive: false,
  showHiddenActive: false,
  favoritesOnlyActive: true,
  hiddenPoiIds: new Set(),
  favoritePoiIds: new Set(['favorite-poi']),
  unsavedChanges: false
};

const classes = new Set();
const favoritesOnlyButton = {
  hidden: false,
  disabled: false,
  classList: { toggle: (name, active) => active ? classes.add(name) : classes.delete(name) }
};
const menu = {
  hidden: false,
  classList: { toggle() {} },
  querySelector: (selector) => selector === '[data-action="favorites-only"]' ? favoritesOnlyButton : null
};
const toggleButton = { hidden: false, classList: { toggle() {} } };
const qs = (selector) => selector === '#poiHideMenu' ? menu : toggleButton;
const hasActiveRoute = () => true;

const syncPoiHideMenuState = new Function(
  'qs', 'hasActiveRoute', 'poiVisibilityState',
  `${extractFunction('syncPoiHideMenuState')}; return syncPoiHideMenuState;`
)(qs, hasActiveRoute, poiVisibilityState);
const resetPoiVisibilityState = new Function(
  'poiVisibilityState',
  `${extractFunction('resetPoiVisibilityState')}; return resetPoiVisibilityState;`
)(poiVisibilityState);
const updatePoiHideControlsVisibility = new Function(
  'qs', 'hasActiveRoute', 'poiVisibilityState', 'resetPoiVisibilityState', 'syncPoiHideMenuState',
  `${extractFunction('updatePoiHideControlsVisibility')}; return updatePoiHideControlsVisibility;`
)(qs, hasActiveRoute, poiVisibilityState, resetPoiVisibilityState, syncPoiHideMenuState);

const activePoints = [{ id: 'favorite-poi' }, { id: 'regular-poi' }];
const getVisiblePoints = new Function(
  'getVisiblePointIndices', 'activePoints', 'poiVisibilityState', 'isPoiFavorite', 'appState',
  `${extractFunction('getVisiblePoints')}; return getVisiblePoints;`
)(
  () => [0, 1],
  activePoints,
  poiVisibilityState,
  (id) => poiVisibilityState.favoritePoiIds.has(id),
  { showBadges: false, hideNoBadges: false }
);

assert.deepEqual(getVisiblePoints(null).map(({ id }) => id), ['favorite-poi']);

poiVisibilityState.hideModeActive = false;
updatePoiHideControlsVisibility();
assert.equal(poiVisibilityState.favoritesOnlyActive, true, 'closing the POI submenu must preserve the favorites filter');
assert.deepEqual(getVisiblePoints(null).map(({ id }) => id), ['favorite-poi']);

poiVisibilityState.hideModeActive = true;
updatePoiHideControlsVisibility();
assert.equal(classes.has('is-active'), true, 'reopening the POI submenu must restore the active button state');

console.log('POI favorites filter regression test passed');
