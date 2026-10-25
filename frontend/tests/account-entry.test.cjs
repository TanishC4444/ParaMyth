const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function accountPage(signup, available) {
  const file = resolve(__dirname, '../src/AccountPage.tsx');
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  const exports = {};
  const nativeRequire = createRequire(file);
  vm.runInNewContext(code, {exports, require: id => id.endsWith('.css') ? {} : id === './transport' ? {backendFetch: async () => {throw Error('Not submitted')}} : nativeRequire(id)});
  return renderToStaticMarkup(React.createElement(exports.default, {signup, available, onSignedIn: async () => {}}));
}

test('sign-in has labelled credentials and an accessible signup link', () => {
  const html = accountPage(false, true);
  assert.match(html, /Email address/);
  assert.match(html, /type="email"/);
  assert.match(html, /type="password"/);
  assert.match(html, /autoComplete="current-password"/);
  assert.match(html, /href="#\/signup"/);
  assert.doesNotMatch(html, /disabled=""/);
});

test('signup has a name field and never asks visitors for provider keys', () => {
  const html = accountPage(true, true);
  assert.match(html, /Your name/);
  assert.match(html, /autoComplete="new-password"/);
  assert.match(html, /Create account/);
  assert.doesNotMatch(html, /name="(?:api_key|token)"/);
});

test('an unconnected static export explains availability and makes no false submission', () => {
  const html = accountPage(false, false);
  assert.match(html, /online studio isn’t connected/);
  assert.match(html, /disabled=""/);
  assert.match(html, /href="#\/atlas"/);
});
