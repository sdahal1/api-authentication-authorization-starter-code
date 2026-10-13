const $ = (id) => document.getElementById(id);
const PKCE_KEY = 'bank-demo-oauth-transaction';
const REQUIRED_SCOPE = 'bank-api/accounts.read';
let config;
// Deliberately not localStorage/sessionStorage/cookies. A reload drops the token.
let accessToken = null;
let expiresAt = 0;

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

function showResult(label, value) {
  $('result-label').textContent = label;
  $('result').textContent = JSON.stringify(value, null, 2);
}

function clearToken() {
  accessToken = null;
  expiresAt = 0;
  $('session').textContent = 'No access token in this page. Sign in to request protected data.';
}

async function signIn(includeScope = true) {
  clearToken();
  const verifier = randomString();
  const state = randomString();
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  // Only one-time PKCE material survives the redirect. Never store tokens here.
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({verifier, state, includeScope, createdAt: Date.now()}));
  const url = new URL('/oauth2/authorize', config.cognitoDomain);
  url.search = new URLSearchParams({
    response_type: 'code', client_id: config.clientId, redirect_uri: config.redirectUri,
    scope: includeScope ? `openid ${REQUIRED_SCOPE}` : 'openid',
    state, code_challenge_method: 'S256', code_challenge: challenge, prompt: 'login',
  });
  location.assign(url);
}

async function handleCallback(params) {
  if (!params.has('code') && !params.has('error')) return;
  const raw = sessionStorage.getItem(PKCE_KEY);
  sessionStorage.removeItem(PKCE_KEY);
  const saved = raw ? JSON.parse(raw) : null;
  if (!saved || params.get('state') !== saved.state || Date.now() - saved.createdAt > 15 * 60 * 1000) {
    throw new Error('Sign-in could not be verified or took too long. Start sign-in again in this tab.');
  }
  if (params.has('error')) throw new Error('Sign-in was not completed. Try again.');
  const response = await fetch(new URL('/oauth2/token', config.cognitoDomain), {
    method: 'POST', credentials: 'omit', cache: 'no-store',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      grant_type: 'authorization_code', client_id: config.clientId,
      code: params.get('code'), redirect_uri: config.redirectUri, code_verifier: saved.verifier,
    }),
  });
  if (!response.ok) throw new Error('Token exchange failed. Check the callback URL and start sign-in again.');
  const tokens = await response.json();
  if (typeof tokens.access_token !== 'string' || tokens.token_type?.toLowerCase() !== 'bearer') {
    throw new Error('The sign-in response did not include a bearer access token.');
  }
  accessToken = tokens.access_token;
  expiresAt = Date.now() + Number(tokens.expires_in) * 1000;
  $('session').textContent = saved.includeScope
    ? 'Signed in. Try a protected request: Gateway checks the token and scope, then the backend checks account access.'
    : 'Signed in without the account-read scope. Protected requests should receive HTTP 403.';
  // The ID token and refresh token are not used or persisted by this short demo.
}

async function apiRequest(path, withToken = true) {
  if (accessToken && Date.now() >= expiresAt) clearToken();
  const headers = {};
  if (withToken && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(`${config.apiUrl}${path}`, {headers, cache: 'no-store', credentials: 'omit'});
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = {message: 'The API returned a non-JSON response.'}; }
  showResult(`GET ${path} → HTTP ${response.status}`, body);
}

function onClick(id, action) {
  $(id).addEventListener('click', async () => {
    const button = $(id);
    button.disabled = true;
    try { await action(); }
    catch (error) { showResult('Request could not complete', {message: error.message}); }
    finally { button.disabled = false; }
  });
}

async function start() {
  // Remove the one-time authorization code before loading any more resources.
  // The local server also avoids logging query strings.
  const params = new URLSearchParams(location.search);
  if (params.has('code') || params.has('error')) history.replaceState(null, '', location.pathname);
  document.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  const response = await fetch('./config.json', {cache: 'no-store'});
  if (!response.ok) throw new Error('Run scripts/configure.py after deploying to create web/config.json.');
  config = await response.json();
  if (location.origin + location.pathname !== config.redirectUri) {
    throw new Error(`Open the app at ${config.redirectUri} so the Cognito callback matches.`);
  }
  clearToken();
  try { await handleCallback(params); }
  catch (error) { showResult('Sign-in needs attention', {message: error.message}); }
  document.querySelectorAll('button').forEach((button) => { button.disabled = false; });
  onClick('signin', () => signIn(true));
  onClick('noscope', () => signIn(false));
  onClick('signout', () => {
    clearToken();
    sessionStorage.removeItem(PKCE_KEY);
    const url = new URL('/logout', config.cognitoDomain);
    url.search = new URLSearchParams({client_id: config.clientId, logout_uri: config.redirectUri});
    location.assign(url);
  });
  onClick('branches', () => apiRequest('/branches', false));
  onClick('accounts', () => apiRequest('/accounts'));
  onClick('noauth', () => apiRequest('/accounts', false));
  onClick('balance', () => {
    const id = $('accountId').value.trim();
    if (!id || id.length > 100) throw new Error('Enter a short demo account ID.');
    return apiRequest(`/accounts/${encodeURIComponent(id)}/balance`);
  });
}

start().catch((error) => {
  clearToken();
  showResult('Setup or sign-in needs attention', {message: error.message});
});
