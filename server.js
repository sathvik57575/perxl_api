const config = require('./src/config');
const { loadModel } = require('./src/model');
const { JsonHistoryStore } = require('./src/historyStore');
const { createScorer } = require('./src/scorer');
const { createApp } = require('./src/app');

let model;
let store;
try {
  model = loadModel(config.modelPath);
  store = new JsonHistoryStore(config.statsPath);
} catch (err) {
  console.error(`Could not load the model files: ${err.message}`);
  console.error('Run scripts/export_for_api.py and copy model_params.json and assignee_stats.json into data/.');
  process.exit(1);
}
const scorer = createScorer({ model, store });
const app = createApp({
  scorer, model, store, apiKey: config.apiKey, maxBatch: config.maxBatch,
  ui: { user: config.uiUser, password: config.uiPassword },
});

app.listen(config.port, () => {
  console.log(`PerXL risk API listening on http://localhost:${config.port}`);
  console.log(`Model exported ${model.trained_export_time}; assignee history snapshot ${store.snapshotTime}`);
  if (!config.apiKey) console.log('Warning: RISK_API_KEY is not set, the API is open.');
  if (!config.uiPassword) console.log('Warning: UI_USER / UI_PASSWORD are not set, the test page is open.');
});
