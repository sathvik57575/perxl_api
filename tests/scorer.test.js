const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadModel, predict } = require('../src/model');
const { JsonHistoryStore } = require('../src/historyStore');
const { createScorer } = require('../src/scorer');
const { ValidationError } = require('../src/errors');
const parity = require('./parity.json');

const model = loadModel(path.join(__dirname, '..', 'data', 'model_params.json'));
const store = new JsonHistoryStore(path.join(__dirname, '..', 'data', 'assignee_stats.json'));
const { score } = createScorer({ model, store });
const NOW = new Date('2026-10-29T10:00:00Z');

test('JavaScript model matches the scikit-learn probabilities', () => {
  for (const r of parity.rows) {
    const { probability } = predict(model, r.lead_days_log, r.asg_late_rate);
    assert.ok(Math.abs(probability - r.expected) < 1e-9, `got ${probability}, expected ${r.expected}`);
  }
});

test('lead time is computed from creation to due date', () => {
  const r = score({ dueDate: '2026-11-08T10:00:00Z', createdOn: '2026-10-29T10:00:00Z', assigneeHistory: { n: 40, late: 28 } }, NOW);
  assert.equal(r.inputsUsed.leadDays, 10);
});

test('assignee late rate is shrunk towards the organisation rate', () => {
  const r = score({ dueDate: '2026-11-08T10:00:00Z', assigneeHistory: { n: 40, late: 28 } }, NOW);
  const expected = (28 + model.shrink_k * model.global_late_rate) / (40 + model.shrink_k);
  assert.ok(Math.abs(r.inputsUsed.assigneeLateRate - expected) < 1e-4);
});

test('shorter lead time and a worse assignee history raise the risk', () => {
  const base = { assigneeHistory: { n: 50, late: 25 } };
  const short = score({ ...base, dueDate: '2026-10-31T10:00:00Z' }, NOW).probability;
  const long = score({ ...base, dueDate: '2026-12-15T10:00:00Z' }, NOW).probability;
  assert.ok(short > long);
  const good = score({ dueDate: '2026-11-05T10:00:00Z', assigneeHistory: { n: 50, late: 10 } }, NOW).probability;
  const bad = score({ dueDate: '2026-11-05T10:00:00Z', assigneeHistory: { n: 50, late: 45 } }, NOW).probability;
  assert.ok(bad > good);
});

test('unknown assignee falls back to the organisation average with a warning', () => {
  const r = score({ dueDate: '2026-11-08T10:00:00Z', assigneeId: 'does-not-exist' }, NOW);
  assert.equal(r.inputsUsed.historySource, 'organisation average');
  assert.equal(r.inputsUsed.assigneeHistoryTasks, 0);
  assert.ok(r.warnings.some((w) => /No history/.test(w)));
});

test('known assignee uses the history store', () => {
  const id = Object.keys(store.assignees)[0];
  const r = score({ dueDate: '2026-11-08T10:00:00Z', assigneeId: id }, NOW);
  assert.equal(r.inputsUsed.historySource, 'history store');
  assert.equal(r.inputsUsed.assigneeHistoryTasks, store.get(id).n);
});

test('a due date before creation or under one day is flagged', () => {
  const past = score({ dueDate: '2026-10-28T10:00:00Z' }, NOW);
  assert.ok(past.warnings.some((w) => /not after/.test(w)));
  const soon = score({ dueDate: '2026-10-29T20:00:00Z' }, NOW);
  assert.ok(soon.warnings.some((w) => /under 1 day/.test(w)));
});

test('result contains factors, risk level and limitations', () => {
  const r = score({ dueDate: '2026-11-08T10:00:00Z', assigneeHistory: { n: 40, late: 28 } }, NOW);
  assert.equal(r.factors.length, 2);
  assert.ok(['higher', 'lower'].includes(r.riskLevel));
  assert.ok(r.probability > 0 && r.probability < 1);
  assert.ok(r.limitations.length > 0);
  assert.ok(r.factors[0].strength >= r.factors[1].strength);
});

test('invalid input is rejected with details', () => {
  assert.throws(() => score({}, NOW), (e) => e instanceof ValidationError && e.details[0].field === 'dueDate');
  assert.throws(() => score({ dueDate: 'not a date' }, NOW), ValidationError);
  assert.throws(() => score({ dueDate: '2026-11-08', assigneeHistory: { n: 5, late: 9 } }, NOW), ValidationError);
  assert.throws(() => score([], NOW), ValidationError);
});
