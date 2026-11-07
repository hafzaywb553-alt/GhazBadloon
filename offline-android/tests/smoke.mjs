import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match, 'The offline app script must exist.');

let script = match[1];
const marker = 'render();\n})();';
assert.ok(script.includes(marker), 'The app startup marker must exist.');
script = script.replace(marker, 'window.__offlineTest = { taxFor, convertDate };\n' + marker);

const view = { innerHTML: '' };
const document = {
  addEventListener() {},
  querySelectorAll() { return []; },
  getElementById(id) { return id === 'view' ? view : { textContent: '', classList: { add() {}, remove() {} } }; }
};
const storage = new Map();
const window = { scrollTo() {} };
const context = {
  window,
  document,
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); }
  },
  Intl, Date, Math, JSON, String, Number, Array, Object, Map, Blob, URL,
  FileReader: class {}, confirm() { return true; }, setTimeout() {}, console
};

vm.runInNewContext(script, context, { timeout: 5000 });
const api = window.__offlineTest;
assert.ok(api, 'Offline app test functions must be available.');

const taxCases = [
  [10000, 0],
  [10001, 1000.1],
  [100000, 10000],
  [100001, 15000.15]
];
for (const [amount, expected] of taxCases) {
  assert.equal(api.taxFor(amount), expected, 'Tax bracket for AFN ' + amount);
}

const converted = api.convertDate('1405/06/08', 'solar');
assert.deepEqual(
  JSON.parse(JSON.stringify(converted)),
  { solar: '1405/06/08', lunar: '1448/03/17', gregorian: '2026/08/30' },
  'Solar to Lunar and Gregorian date example'
);
assert.equal(api.convertDate('2026/02/30', 'gregorian'), null, 'Invalid Gregorian date should be rejected.');
assert.equal(api.convertDate('۱۴۰۵/۰۶/۰۸', 'solar').gregorian, '2026/08/30', 'Persian digits should be accepted.');

console.log('Offline smoke tests passed: tax brackets, date conversion, invalid dates and Persian digits.');
