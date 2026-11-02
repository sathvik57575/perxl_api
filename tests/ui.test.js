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

function start(ui = {}) {
  return new Promise((resolve) => {
    const server = createApp({ scorer, model, store, ui, apiKey: 'api-secret' }).listen(0, () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}
const post = (url, body, headers = {}) => fetch(url, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const due = (days) => new Date(Date.now() + days * 86400000).toISOString();

test('test page renders with the assignee list and without internal IDs', async () => {
  const { server, base } = await start();
  try {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<form id="score-form"/);
    assert.match(html, /id="batch-tab"/);
    assert.match(html, /id="csv-file"/);
    assert.match(html, /id="batch-json"/);
    assert.match(html, /Assignee 1 \(/);
    for (const id of Object.keys(store.assignees)) assert.ok(!html.includes(id), 'assignee ID leaked into the page');
    assert.equal((await fetch(`${base}/static/app.js`)).status, 200);
    assert.equal((await fetch(`${base}/static/style.css`)).status, 200);
  } finally { server.close(); }
});

test('the page works without the API key, which stays required on /api', async () => {
  const { server, base } = await start();
  try {
    const res = await post(`${base}/ui/score`, { assigneeRef: 'unknown', dueDate: due(10) });
    assert.equal(res.status, 200);
    assert.ok((await res.json()).probability > 0);
    assert.equal((await post(`${base}/api/v1/risk/score`, { dueDate: due(10) })).status, 401);
  } finally { server.close(); }
});

test('assignee reference and manual history are resolved on the server', async () => {
  const { server, base } = await start();
  try {
    const known = await (await post(`${base}/ui/score`, { assigneeRef: '1', dueDate: due(10) })).json();
    assert.equal(known.inputsUsed.historySource, 'history store');
    const manual = await (await post(`${base}/ui/score`, { assigneeRef: 'manual', history: { n: 50, late: 40 }, dueDate: due(2) })).json();
    assert.equal(manual.inputsUsed.historySource, 'request');
    const calm = await (await post(`${base}/ui/score`, { assigneeRef: 'manual', history: { n: 50, late: 15 }, dueDate: due(30) })).json();
    assert.ok(manual.probability > calm.probability);
  } finally { server.close(); }
});

test('batch UI scoring returns per-task results without exposing assignee IDs', async () => {
  const { server, base } = await start();
  try {
    const response = await post(`${base}/ui/score/batch`, {
      tasks: [
        { taskId: 'TASK-001', assigneeId: 'uploaded-worker-secret', dueDate: due(10) },
        { taskId: 'TASK-002', assigneeId: 'uploaded-worker-secret', dueDate: 'invalid' },
        { taskId: 'TASK-003', dueDate: due(20) },
      ],
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.count, 3);
    assert.equal(body.results[0].ok, true);
    assert.equal(body.results[0].taskId, 'TASK-001');
    assert.equal(body.results[0].assignee, 'Uploaded assignee 1');
    assert.equal(body.results[1].ok, false);
    assert.equal(body.results[1].error.details[0].field, 'dueDate');
    assert.equal(body.results[1].assignee, body.results[0].assignee);
    assert.equal(body.results[2].assignee, 'Unknown');
    assert.ok(!JSON.stringify(body).includes('uploaded-worker-secret'));

    const tooMany = await post(`${base}/ui/score/batch`, { tasks: Array(101).fill({}) });
    assert.equal(tooMany.status, 400);
    assert.match((await tooMany.json()).error.message, /At most 100/);
  } finally { server.close(); }
});

test('bad input from the page returns 400 with details', async () => {
  const { server, base } = await start();
  try {
    const noDate = await post(`${base}/ui/score`, { assigneeRef: 'unknown' });
    assert.equal(noDate.status, 400);
    assert.equal((await noDate.json()).error.details[0].field, 'dueDate');
    const badRef = await post(`${base}/ui/score`, { assigneeRef: '9999', dueDate: due(5) });
    assert.equal(badRef.status, 400);
    const badHist = await post(`${base}/ui/score`, { assigneeRef: 'manual', history: { n: 5, late: 9 }, dueDate: due(5) });
    assert.equal(badHist.status, 400);
  } finally { server.close(); }
});

test('basic auth protects the page when configured', async () => {
  const { server, base } = await start({ user: 'tester', password: 'pw' });
  try {
    assert.equal((await fetch(`${base}/`)).status, 401);
    assert.equal((await post(`${base}/ui/score`, { assigneeRef: 'unknown', dueDate: due(5) })).status, 401);
    assert.equal((await post(`${base}/ui/score/batch`, { tasks: [{ dueDate: due(5) }] })).status, 401);
    const auth = { authorization: 'Basic ' + Buffer.from('tester:pw').toString('base64') };
    assert.equal((await fetch(`${base}/`, { headers: auth })).status, 200);
    assert.equal((await post(`${base}/ui/score`, { assigneeRef: 'unknown', dueDate: due(5) }, auth)).status, 200);
    assert.equal((await post(`${base}/ui/score/batch`, { tasks: [{ dueDate: due(5) }] }, auth)).status, 200);
    const wrong = { authorization: 'Basic ' + Buffer.from('tester:nope').toString('base64') };
    assert.equal((await fetch(`${base}/`, { headers: wrong })).status, 401);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  } finally { server.close(); }
});
