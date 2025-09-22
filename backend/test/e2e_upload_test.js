// Simple end-to-end test: signup -> login -> upload -> parse -> fetch events
const fs = require('fs');
const path = require('path');
const { request, FormData, setGlobalDispatcher } = require('undici');

const BASE = process.env.BASE_URL || 'http://localhost:4000';

async function signup(email, password) {
  const res = await request(`${BASE}/auth/signup`, { method: 'POST', body: JSON.stringify({ id: email.split('@')[0], email, password }), headers: { 'content-type': 'application/json' } });
  return res;
}

async function login(email, password) {
  const res = await request(`${BASE}/auth/login`, { method: 'POST', body: JSON.stringify({ email, password }), headers: { 'content-type': 'application/json' } });
  // read set-cookie header
  const setCookie = res.headers['set-cookie'];
  return setCookie;
}

async function upload(cookie, filePath) {
  const form = new FormData();
  form.set('file', fs.createReadStream(filePath));

  const res = await request(`${BASE}/uploads`, { method: 'POST', body: form, headers: { cookie } });
  const body = await res.body.text();
  return { statusCode: res.statusCode, body: body };
}

async function triggerParse(cookie, id) {
  const res = await request(`${BASE}/uploads/${id}/parse`, { method: 'POST', headers: { cookie } });
  return res;
}

async function main() {
  const email = `jinishshah00@gmail.com`;
  const password = 'admin123';
  console.log('Signing up...');
  await signup(email, password);
  console.log('Logging in...');
  const setCookie = await login(email, password);
  if (!setCookie) return console.error('login failed');
  const cookie = Array.isArray(setCookie) ? setCookie.join(';') : setCookie;

  console.log('Uploading sample...');
  const sample = path.join(__dirname, '..', 'samples', 'apache_small.log');
  const up = await upload(cookie, sample);
  console.log('upload response', up.statusCode, up.body);
  let respJson;
  try { respJson = JSON.parse(up.body); } catch (e) { console.error('bad upload json', up.body); return; }
  const id = respJson.upload?.id;
  if (!id) return console.error('no upload id');

  console.log('Triggering parse...');
  const p = await triggerParse(cookie, id);
  console.log('parse status', p.statusCode);
  const parseBody = await p.body.text();
  console.log('parse body', parseBody);
  console.log('Done. Now query DB or UI to inspect events for enrichment.');
}

main().catch(e => { console.error(e); process.exit(1); });
