const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { ValidationError } = require('./errors');

/** Optional HTTP Basic auth for the test page. Disabled when no user/password is configured. */
function basicAuth(user, password) {
  if (!user || !password) return (req, res, next) => next();
  const expected = Buffer.from(`${user}:${password}`);
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    if (header.startsWith('Basic ')) {
      const given = Buffer.from(Buffer.from(header.slice(6), 'base64').toString());
      if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="PerXL risk test page"').status(401).send('Authentication required');
  };
}

/**
 * Small EJS test page. The browser calls /ui/score on the same server, so the API key never
 * has to be shown in the page. Assignees appear as "Assignee 1, 2, ..." (no internal IDs in the HTML).
 */
function registerUi(app, { scorer, model, store, user = '', password = '' }) {
  const auth = basicAuth(user, password);
  const ids = Object.entries(store.assignees)
    .sort((a, b) => b[1].n - a[1].n)
    .map(([id]) => id);
  const assignees = ids.map((id, i) => {
    const s = store.get(id);
    return { ref: String(i + 1), label: `Assignee ${i + 1} (${s.n} past tasks, ${Math.round((s.late / s.n) * 100)}% late)` };
  });
  const knownAssigneeLabels = new Map(ids.map((id, i) => [id, `Assignee ${i + 1}`]));

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use('/static', auth, express.static(path.join(__dirname, '..', 'public')));

  app.get('/', auth, (req, res) => {
    res.render('index', {
      assignees,
      model: { name: model.model_name, target: model.target, limitations: model.limitations },
      snapshot: store.snapshotTime,
    });
  });

  app.post('/ui/score', auth, express.json({ limit: '10kb' }), (req, res, next) => {
    try {
      const { assigneeRef, dueDate, createdOn, history } = req.body || {};
      const input = { dueDate, createdOn: createdOn || undefined };
      if (assigneeRef === 'manual') {
        input.assigneeHistory = history;
      } else if (assigneeRef && assigneeRef !== 'unknown') {
        const id = ids[Number(assigneeRef) - 1];
        if (!id) throw new ValidationError('Invalid request', [{ field: 'assigneeRef', message: 'unknown assignee' }]);
        input.assigneeId = id;
      }
      res.json(scorer.score(input));
    } catch (e) { next(e); }
  });

  app.post('/ui/score/batch', auth, express.json({ limit: '200kb' }), (req, res, next) => {
    try {
      const tasks = req.body && req.body.tasks;
      if (!Array.isArray(tasks) || tasks.length === 0) throw new ValidationError('"tasks" must be a non-empty array');
      if (tasks.length > 100) throw new ValidationError('At most 100 tasks per request');

      const uploadedLabels = new Map();
      let nextUploadedLabel = 1;
      const results = tasks.map((task, index) => {
        const assigneeId = task && task.assigneeId;
        let assignee = 'Unknown';
        if (typeof assigneeId === 'string' && assigneeId.trim()) {
          const normalizedId = assigneeId.trim();
          assignee = knownAssigneeLabels.get(normalizedId);
          if (!assignee) {
            if (!uploadedLabels.has(normalizedId)) uploadedLabels.set(normalizedId, `Uploaded assignee ${nextUploadedLabel++}`);
            assignee = uploadedLabels.get(normalizedId);
          }
        } else if (assigneeId !== undefined && assigneeId !== null) {
          assignee = 'Invalid assignee';
        }

        const taskId = task && typeof task.taskId === 'string' ? task.taskId : null;
        try {
          const prediction = scorer.score(task);
          return {
            index,
            ok: true,
            taskId: prediction.taskId === null ? taskId : String(prediction.taskId),
            assignee,
            probability: prediction.probability,
            riskLevel: prediction.riskLevel,
          };
        } catch (e) {
          if (e instanceof ValidationError) {
            return {
              index,
              ok: false,
              taskId,
              assignee,
              error: { code: e.code, message: e.message, details: e.details },
            };
          }
          throw e;
        }
      });
      res.json({ count: results.length, results });
    } catch (e) { next(e); }
  });
}

module.exports = { registerUi, basicAuth };
