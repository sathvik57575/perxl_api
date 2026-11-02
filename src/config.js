const path = require('path');

module.exports = {
  port: Number(process.env.PORT) || 3000,
  // Optional: when set, every /api request must send this value in the x-api-key header.
  apiKey: process.env.RISK_API_KEY || '',
  // Optional: when both are set, the test page at / is protected with HTTP Basic auth.
  uiUser: process.env.UI_USER || '',
  uiPassword: process.env.UI_PASSWORD || '',
  modelPath: process.env.MODEL_PARAMS || path.join(__dirname, '..', 'data', 'model_params.json'),
  statsPath: process.env.ASSIGNEE_STATS || path.join(__dirname, '..', 'data', 'assignee_stats.json'),
  maxBatch: 100,
};
