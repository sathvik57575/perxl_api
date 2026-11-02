const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadModel } = require('../src/model');
const { JsonHistoryStore } = require('../src/historyStore');
const { createScorer } = require('../src/scorer');
const { createApp } = require('../src/app');

const model = loadModel(path.join(__dirname, '..', 'data', 'model_params.json'));
const store = new JsonHistoryStore(path.join(__dirname, '..', 'data', 'assignee_stats.json'));
const scorer = createScorer({ model, store });

function start(apiKey = '') {
  return new Promise((resolve) => {
    const server = createApp({ scorer, model, store, apiKey, maxBatch: 3 }).listen(0, () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}
const post = (url, body, headers = {}) => fetch(url, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
});
const soon = (days) => new Date(Date.now() + days * 86400000).toISOString();

test('health and model info', async () => {
  const { server, base } = await start();
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const info = await (await fetch(`${base}/api/v1/model`)).json();
    assert.equal(info.graceDays, model.grace_days);
    assert.ok(info.limitations.length > 0);
  } finally { server.close(); }
});

test('POST /api/v1/risk/score returns a prediction', async () => {
  const { server, base } = await start();
  try {
    const res = await post(`${base}/api/v1/risk/score`, { taskId: 'T-1', dueDate: soon(10), assigneeHistory: { n: 40, late: 28 } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.taskId, 'T-1');
    assert.ok(body.probability > 0 && body.probability < 1);
    assert.ok(['higher', 'lower'].includes(body.riskLevel));
    assert.equal(body.factors.length, 2);
  } finally { server.close(); }
});

test('validation errors return 400 with details', async () => {
  const { server, base } = await start();
  try {
    const res = await post(`${base}/api/v1/risk/score`, {});
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'validation_error');
    assert.equal(body.error.details[0].field, 'dueDate');
    const bad = await post(`${base}/api/v1/risk/score`, '{not json');
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, 'invalid_json');
  } finally { server.close(); }
});

test('batch scoring reports each task separately', async () => {
  const { server, base } = await start();
  try {
    const res = await post(`${base}/api/v1/risk/score/batch`, { tasks: [{ dueDate: soon(3) }, { dueDate: 'nope' }, { dueDate: soon(40) }] });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.count, 3);
    assert.equal(body.results[0].ok, true);
    assert.equal(body.results[1].ok, false);
    assert.ok(body.results[0].probability > body.results[2].probability);
    const tooMany = await post(`${base}/api/v1/risk/score/batch`, { tasks: [{}, {}, {}, {}] });
    assert.equal(tooMany.status, 400);
  } finally { server.close(); }
});

test('API key is enforced when configured', async () => {
  const { server, base } = await start('secret');
  try {
    assert.equal((await post(`${base}/api/v1/risk/score`, { dueDate: soon(5) })).status, 401);
    assert.equal((await post(`${base}/api/v1/risk/score`, { dueDate: soon(5) }, { 'x-api-key': 'secret' })).status, 200);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  } finally { server.close(); }
});

test('unknown routes return 404', async () => {
  const { server, base } = await start();
  try { assert.equal((await fetch(`${base}/nope`)).status, 404); } finally { server.close(); }
});
