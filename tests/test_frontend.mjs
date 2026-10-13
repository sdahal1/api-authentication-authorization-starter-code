// Dependency-free tests of the browser's security-relevant flow, with fake network/DOM.
// These do not replace a live Cognito sign-in test.
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
const config = {apiUrl: 'https://api.example.test', cognitoDomain: 'https://login.example.test',
  clientId: 'demo-client', redirectUri: 'http://localhost:8080/'};
const TOKEN = 'FAKE_ACCESS_TOKEN_FOR_LOCAL_TEST_ONLY';
const transactionKey = 'bank-demo-oauth-transaction';

async function start({query = '', state = 'expected', createdAt = Date.now()} = {}) {
  const elements = new Map();
  const storage = new Map();
  const requests = [];
  const destinations = [];
  const history = [];
  if (query) storage.set(transactionKey, JSON.stringify({state, createdAt, verifier: 'verifier', includeScope: true}));
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: '5521', textContent: '', disabled: false, listeners: {},
      addEventListener(name, listener) { this.listeners[name] = listener; },
    });
    return elements.get(id);
  }
  for (const id of ['branches', 'signin', 'signout', 'accounts', 'balance', 'noscope', 'noauth']) element(id);
  const context = vm.createContext({
    URL, URLSearchParams, Uint8Array, TextEncoder, crypto: webcrypto, btoa,
    document: {getElementById: element, querySelectorAll: () => [...elements.values()]},
    sessionStorage: {getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key)},
    location: {search: query, origin: 'http://localhost:8080', pathname: '/',
      assign: (url) => destinations.push(String(url))},
    history: {replaceState: (...args) => history.push(args)},
    fetch: async (url, options = {}) => {
      requests.push({url: String(url), options});
      if (String(url) === './config.json') return {ok: true, json: async () => config};
      if (String(url).endsWith('/oauth2/token')) return {ok: true, json: async () => ({
        access_token: TOKEN, token_type: 'Bearer', expires_in: 900,
      })};
      return {ok: true, status: 200, text: async () => '{"ok":true}'};
    },
  });
  vm.runInContext(source, context);
  await new Promise(setImmediate);
  return {elements, storage, requests, destinations, history,
    click: async (id) => element(id).listeners.click()};
}

test('valid callback consumes state, removes the code URL, and keeps token out of browser storage', async () => {
  const app = await start({query: '?code=one-time-code&state=expected'});
  assert.equal(app.history[0][2], '/');
  assert.equal(app.storage.size, 0);
  const tokenRequest = app.requests.find((request) => request.url.endsWith('/oauth2/token'));
  assert.equal(tokenRequest.options.body.get('code_verifier'), 'verifier');
  assert.equal(tokenRequest.options.body.get('client_secret'), null);
  await app.click('accounts');
  assert.equal(app.requests.at(-1).options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.ok(![...app.elements.values()].some((element) => element.textContent.includes(TOKEN)));
});

test('wrong or stale OAuth state prevents code exchange and leaves retry available', async () => {
  for (const options of [
    {query: '?code=stolen-code&state=wrong'},
    {query: '?code=old-code&state=expected', createdAt: Date.now() - 16 * 60 * 1000},
  ]) {
    const app = await start(options);
    assert.ok(!app.requests.some((request) => request.url.endsWith('/oauth2/token')));
    assert.equal(app.storage.size, 0);
    assert.equal(app.elements.get('signin').disabled, false);
    assert.match(app.elements.get('result').textContent, /verified or took too long/);
  }
});

test('public and explicit unauthenticated requests omit bearer credentials even after sign-in', async () => {
  const app = await start({query: '?code=code&state=expected'});
  await app.click('branches');
  assert.equal(app.requests.at(-1).options.headers.Authorization, undefined);
  await app.click('noauth');
  assert.equal(app.requests.at(-1).options.headers.Authorization, undefined);
});

test('sign-in uses S256 PKCE and state; diagnostic sign-in omits account scope', async () => {
  const app = await start();
  await app.click('noscope');
  const destination = new URL(app.destinations.at(-1));
  assert.equal(destination.pathname, '/oauth2/authorize');
  assert.equal(destination.searchParams.get('scope'), 'openid');
  assert.equal(destination.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(destination.searchParams.get('response_type'), 'code');
  const transaction = JSON.parse(app.storage.get(transactionKey));
  assert.equal(destination.searchParams.get('state'), transaction.state);
  assert.notEqual(destination.searchParams.get('code_challenge'), transaction.verifier);
  assert.ok(!JSON.stringify(transaction).includes(TOKEN));
});

test('sign-out visits Cognito logout and clears the token before the next protected request', async () => {
  const app = await start({query: '?code=code&state=expected'});
  await app.click('signout');
  assert.equal(new URL(app.destinations.at(-1)).pathname, '/logout');
  await app.click('accounts');
  assert.equal(app.requests.at(-1).options.headers.Authorization, undefined);
});
