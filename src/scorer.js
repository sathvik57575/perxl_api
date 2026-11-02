const { predict } = require('./model');
const { ValidationError } = require('./errors');

const DAY_MS = 86400000;

function parseDate(value, field, problems) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) problems.push({ field, message: 'must be a valid ISO 8601 date, for example 2026-11-20T18:29:59Z' });
  return d;
}

/** Validates one scoring request and returns clean values, or throws ValidationError. */
function validate(input, now = new Date()) {
  const problems = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ValidationError('Request body must be a JSON object');
  }
  const due = parseDate(input.dueDate, 'dueDate', problems);
  if (input.dueDate === undefined || input.dueDate === null || input.dueDate === '') {
    problems.push({ field: 'dueDate', message: 'is required' });
  }
  const created = parseDate(input.createdOn, 'createdOn', problems) || now;

  let assigneeId = null;
  if (input.assigneeId !== undefined && input.assigneeId !== null) {
    if (typeof input.assigneeId !== 'string' || !input.assigneeId.trim()) {
      problems.push({ field: 'assigneeId', message: 'must be a non-empty string' });
    } else {
      assigneeId = input.assigneeId.trim();
    }
  }

  let history = null;
  if (input.assigneeHistory !== undefined && input.assigneeHistory !== null) {
    const { n, late } = input.assigneeHistory;
    if (!Number.isInteger(n) || n < 0) problems.push({ field: 'assigneeHistory.n', message: 'must be an integer >= 0' });
    else if (!Number.isInteger(late) || late < 0 || late > n) problems.push({ field: 'assigneeHistory.late', message: 'must be an integer between 0 and n' });
    else history = { n, late };
  }

  if (problems.length) throw new ValidationError('Invalid request', problems);
  return { due, created, assigneeId, history, taskId: input.taskId ?? null };
}

/**
 * Builds the scoring function used by the API.
 * @param {object} deps  { model: params, store: history store }
 */
function createScorer({ model, store }) {
  const pct = (x) => `${Math.round(x * 100)}%`;

  function score(input, now = new Date()) {
    const { due, created, assigneeId, history, taskId } = validate(input, now);
    const warnings = [];

    // --- feature 1: lead time (creation to due date), as in training
    const leadDays = (due.getTime() - created.getTime()) / DAY_MS;
    if (leadDays <= 0) warnings.push('The due date is not after the creation time. The model was trained on tasks created at least 1 day before their deadline, so this score is unreliable.');
    else if (leadDays < model.training_lead_days_min) warnings.push('Lead time is under 1 day, which is outside the range the model was trained on.');
    const leadDaysLog = Math.log1p(Math.max(leadDays, 0));

    // --- feature 2: assignee's late rate, shrunk towards the overall rate
    let stats = history;
    let source = 'request';
    if (!stats && assigneeId) { stats = store.get(assigneeId); source = 'history store'; }
    if (!stats) {
      source = 'organisation average';
      stats = { n: 0, late: 0 };
      warnings.push(assigneeId
        ? 'No history found for this assignee; the organisation average was used.'
        : 'No assignee given; the organisation average was used.');
    }
    const g = model.global_late_rate;
    const asgLateRate = (stats.late + model.shrink_k * g) / (stats.n + model.shrink_k);

    const { probability, contributions } = predict(model, leadDaysLog, asgLateRate);

    const factors = [
      {
        factor: 'lead_time',
        effect: contributions[0] > 0 ? 'raises risk' : 'lowers risk',
        strength: Math.abs(contributions[0]),
        description: `${contributions[0] > 0 ? 'Short' : 'Long'} lead time: ${leadDays.toFixed(1)} days between creation and due date`,
      },
      {
        factor: 'assignee_history',
        effect: contributions[1] > 0 ? 'raises risk' : 'lowers risk',
        strength: Math.abs(contributions[1]),
        description: stats.n > 0
          ? `Assignee finished ${pct(asgLateRate)} of their past tasks late (based on ${stats.n} tasks; organisation average ${pct(g)})`
          : `No assignee history, organisation average of ${pct(g)} used`,
      },
    ].sort((a, b) => b.strength - a.strength).map((f) => ({ ...f, strength: Number(f.strength.toFixed(3)) }));

    return {
      taskId,
      probability: Number(probability.toFixed(4)),
      riskLevel: probability >= model.higher_risk_cut ? 'higher' : 'lower',
      predictedLate: probability >= model.flag_threshold,
      factors,
      inputsUsed: {
        leadDays: Number(leadDays.toFixed(2)),
        assigneeLateRate: Number(asgLateRate.toFixed(4)),
        assigneeHistoryTasks: stats.n,
        historySource: source,
      },
      warnings,
      model: {
        name: model.model_name,
        target: model.target,
        riskCutoff: Number(model.higher_risk_cut.toFixed(4)),
        flagThreshold: Number(model.flag_threshold.toFixed(4)),
      },
      limitations: model.limitations,
    };
  }

  return { score, validate };
}

module.exports = { createScorer, validate };
