# PerXL overdue-risk API

Scores a task with the probability that it will be completed more than one day after its due date.
The model is a logistic regression on two inputs: the lead time (creation to due date) and the
assignee's past late rate. The API does not need Python: the model is exported to a small JSON file.

## How the pieces connect

    Colab (training)                         VS Code (this project)
    ----------------                         ----------------------
    prep notebook  -> tasks_clean.csv
    model notebook -> overdue_risk_model.joblib
    scripts/export_for_api.py  ------------>  data/model_params.json
                               ------------>  data/assignee_stats.json
                                              npm start  -> http://localhost:3000

Colab and VS Code are not connected live. The hand-off is two JSON files. Re-run the export whenever
the model is retrained or the assignee history should be refreshed.

## 1. Export from Colab (after running both notebooks)

Upload `scripts/export_for_api.py` to `/content`, then in a new cell:

    !python export_for_api.py --artifact /content/output/overdue_risk_model.joblib --tasks /content/tasks_clean.csv --out /content/api_export
    from google.colab import files
    files.download('/content/api_export/model_params.json'); files.download('/content/api_export/assignee_stats.json')

Copy both downloaded files into `data/`, replacing the sample files that ship with this project
(the samples were generated from a test run, not from your Colab run).

Also regenerate the parity fixture from your own model, otherwise the parity test compares against the sample model
and fails. Upload `scripts/make_parity_fixture.py` to Colab, then:

    !python make_parity_fixture.py --artifact /content/output/overdue_risk_model.joblib --features /content/output/features_all_tasks.csv --out /content/parity.json
    files.download('/content/parity.json')

Copy it to `tests/parity.json`.

## 2. Run the API in VS Code

    npm install
    npm test          # 15 tests, including a check against the scikit-learn probabilities
    npm start         # http://localhost:3000

Settings (environment variables): `PORT`, `RISK_API_KEY` (if set, send it in the `x-api-key` header),
`UI_USER` and `UI_PASSWORD` (if both are set, the test page asks for them), `MODEL_PARAMS`, `ASSIGNEE_STATS`.

## Test page

Open `http://localhost:3000/` for a small page where anyone can try the model: pick a due date and an assignee
(or enter a history by hand), and it shows the probability, risk level, the factors and any warnings. The page
calls `/ui/score` on the same server, so the API key is never exposed in the browser. Assignees appear as
"Assignee 1, 2, ..." and no internal IDs are sent to the page.

## Endpoints

`GET /health`

`GET /api/v1/model` model details, cut-offs and limitations.

`POST /api/v1/risk/score`

    {
      "taskId": "T-1042",                       optional, echoed back
      "assigneeId": "<ResourceID>",             optional, used to look up the assignee's history
      "dueDate": "2026-11-20T18:29:59Z",        required
      "createdOn": "2026-10-29T10:00:00Z",      optional, defaults to now
      "assigneeHistory": { "n": 40, "late": 28 }  optional, overrides the lookup
    }

Example:

    curl -X POST http://localhost:3000/api/v1/risk/score \
      -H "content-type: application/json" \
      -d '{"assigneeHistory":{"n":40,"late":28},"dueDate":"2026-12-01T18:29:59Z"}'

The response has `probability`, `riskLevel` ("higher" or "lower"), `predictedLate`, `factors`
(what raised or lowered the risk, in plain words), `inputsUsed`, `warnings` and `limitations`.

`POST /api/v1/risk/score/batch` with `{ "tasks": [ ... up to 100 ... ] }` returns one result per task;
a bad task returns its own error and does not fail the others.

Errors use the shape `{ "error": { "code", "message", "details" } }` (400 validation, 401 key, 404, 500).

## Integrating with the application

The application only has to call the endpoint when a task is created or its due date or assignee changes,
and store or display `probability`, `riskLevel` and `factors`.

By default the assignee history comes from the exported snapshot (`src/historyStore.js`). For live data, keep
the same `get(assigneeId)` method and return `{ n, late }` from the PerXL database: `n` is the number of
the assignee's tasks with a known outcome (closed, or already overdue by the grace period) and `late` how
many of those finished more than one day after their due date.

## Known limits (see the results report)

- A ranking tool, not a guarantee. Probabilities are not calibrated to current behaviour (the late rate has risen).
- Two risk levels only; the data did not support three.
- Tasks created less than one day before the deadline are outside the training range and return a warning.
- Retrain and re-export regularly.

## Deploying

Needs Node 18 or newer. On the host:

    npm ci --omit=dev
    npm start

- Set `PORT` if the platform requires it, and set `RISK_API_KEY`, `UI_USER` and `UI_PASSWORD` so neither the API nor the page is open.
- Serve it over HTTPS (most platforms do this for you) and use `/health` as the health check.
- The files in `data/` are read once at start-up. To refresh the model or the assignee history, replace both files and restart.
- Keep the repository private: the data files hold assignee IDs and counts.
- If another web application will call the API from a browser, add CORS for its origin; calls from a server need nothing extra.
- There is no rate limiting or request logging yet.
