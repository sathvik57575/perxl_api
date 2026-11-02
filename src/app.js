const express = require('express');
const { ValidationError } = require('./errors');
const { registerUi } = require('./ui');

function createApp({ scorer, model, store, apiKey = '', maxBatch = 100, ui = {} }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '200kb' }));

  app.get('/health', (req, res) => res.json({ status: 'ok', modelLoaded: true }));

  // everything under /api can be protected with a shared key
  app.use('/api', (req, res, next) => {
    if (apiKey && req.get('x-api-key') !== apiKey) {
      return res.status(401).json({ error: { code: 'unauthorized', message: 'Missing or invalid x-api-key header' } });
    }
    next();
  });

  app.get('/api/v1/model', (req, res) => res.json({
    name: model.model_name,
    target: model.target,
    graceDays: model.grace_days,
    inputs: ['task creation time', 'due date', 'assignee'],
    riskCutoff: model.higher_risk_cut,
    historySnapshot: store.snapshotTime,
    exportedAt: model.trained_export_time,
    limitations: model.limitations,
  }));

  app.post('/api/v1/risk/score', (req, res, next) => {
    try { res.json(scorer.score(req.body)); } catch (e) { next(e); }
  });

  app.post('/api/v1/risk/score/batch', (req, res, next) => {
    try {
      const tasks = req.body && req.body.tasks;
      if (!Array.isArray(tasks) || tasks.length === 0) throw new ValidationError('"tasks" must be a non-empty array');
      if (tasks.length > maxBatch) throw new ValidationError(`At most ${maxBatch} tasks per request`);
      const results = tasks.map((t, index) => {
        try { return { index, ok: true, ...scorer.score(t) }; }
        catch (e) {
          if (e instanceof ValidationError) return { index, ok: false, error: { code: e.code, message: e.message, details: e.details } };
          throw e;
        }
      });
      res.json({ count: results.length, results });
    } catch (e) { next(e); }
  });

  registerUi(app, { scorer, model, store, user: ui.user, password: ui.password });

  app.use((req, res) => res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'invalid_json', message: 'Request body is not valid JSON' } });
    }
    console.error(err);
    res.status(500).json({ error: { code: 'internal_error', message: 'Unexpected error' } });
  });

  return app;
}

module.exports = { createApp };
