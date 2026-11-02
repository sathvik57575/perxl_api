const fs = require('fs');

const REQUIRED = ['feature_names', 'imputer_median', 'scaler_mean', 'scaler_scale', 'coefficients',
  'intercept', 'shrink_k', 'global_late_rate', 'higher_risk_cut', 'grace_days'];

/** Loads the parameters exported by scripts/export_for_api.py and checks they are usable. */
function loadModel(path) {
  const params = JSON.parse(fs.readFileSync(path, 'utf8'));
  for (const key of REQUIRED) {
    if (params[key] === undefined) throw new Error(`model file ${path} is missing "${key}"`);
  }
  const k = params.feature_names.length;
  for (const key of ['imputer_median', 'scaler_mean', 'scaler_scale', 'coefficients']) {
    if (params[key].length !== k) throw new Error(`"${key}" must have ${k} values`);
  }
  if (params.feature_names.join() !== 'lead_days_log,asg_late_rate') {
    throw new Error(`unexpected model inputs: ${params.feature_names.join()}`);
  }
  return params;
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/**
 * Logistic regression on standardised features, the same maths as the scikit-learn pipeline
 * (median imputer -> standard scaler -> logistic regression).
 * Returns the probability and each feature's contribution to the log-odds.
 */
function predict(params, leadDaysLog, asgLateRate) {
  const raw = [leadDaysLog, asgLateRate];
  const contributions = raw.map((x, i) => {
    const value = Number.isFinite(x) ? x : params.imputer_median[i];
    const z = (value - params.scaler_mean[i]) / params.scaler_scale[i];
    return params.coefficients[i] * z;
  });
  const logit = params.intercept + contributions.reduce((a, b) => a + b, 0);
  return { probability: sigmoid(logit), logit, contributions };
}

module.exports = { loadModel, predict, sigmoid };
