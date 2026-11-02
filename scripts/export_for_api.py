"""
Export the trained overdue-risk model for the Express API.

Run it where the model was trained (Colab) or anywhere scikit-learn can open the .joblib file:

    python export_for_api.py --artifact /content/output/overdue_risk_model.joblib \
                             --tasks /content/tasks_clean.csv --out /content/api_export

It writes two small JSON files, so the API itself needs no Python or scikit-learn:
    model_params.json    coefficients, scaling, thresholds and metadata of the final model
    assignee_stats.json  how many tasks each assignee has with a known outcome, and how many were late
"""
import argparse, datetime, json
from pathlib import Path

import joblib
import pandas as pd
import sklearn

ap = argparse.ArgumentParser()
ap.add_argument("--artifact", default="/content/output/overdue_risk_model.joblib")
ap.add_argument("--tasks", default="/content/tasks_clean.csv")
ap.add_argument("--out", default="api_export")
ap.add_argument("--shrink-k", type=float, default=8.0, help="must match SHRINK_K in the model notebook")
args = ap.parse_args()

art = joblib.load(args.artifact)
pipe = art["model"]
steps = getattr(pipe, "named_steps", {})
if not {"sel", "imp", "sc", "lr"} <= set(steps):
    raise SystemExit("This exporter supports the final model 'lead time + assignee history' (logistic regression). "
                     "The saved model has a different structure; export it with a different tool or call it through a Python service.")

cols = list(steps["sel"].transformers_[0][2])
if cols != ["lead_days_log", "asg_late_rate"]:
    raise SystemExit(f"Unexpected model inputs {cols}. The API expects ['lead_days_log', 'asg_late_rate'].")

lr, sc, imp = steps["lr"], steps["sc"], steps["imp"]
grace = int(art["grace_days"])
target = f"late_g{grace}"

# ---- assignee history as of the export date (labelled tasks only, same rule as the training features)
t = pd.read_csv(args.tasks)
lab = t[t[target].notna()]
g = lab.groupby("assignee_id")[target].agg(n="size", late="sum")
global_n, global_rate = int(len(lab)), float(lab[target].mean())
now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")

params = {
    "model_name": "overdue-risk lead-time + assignee-history logistic regression",
    "trained_export_time": now,
    "grace_days": grace,
    "target": f"task closes more than {grace} day(s) after its due date",
    "feature_names": cols,
    "imputer_median": [float(x) for x in imp.statistics_],
    "scaler_mean": [float(x) for x in sc.mean_],
    "scaler_scale": [float(x) for x in sc.scale_],
    "coefficients": [float(x) for x in lr.coef_[0]],
    "intercept": float(lr.intercept_[0]),
    "shrink_k": args.shrink_k,
    "global_late_rate": global_rate,
    "flag_threshold": float(art["threshold"]),
    "higher_risk_cut": float(art["band_cuts"][0]),
    "training_lead_days_min": 1,
    "sklearn_version": sklearn.__version__,
    "limitations": [
        "Ranking tool, not a guarantee: a higher probability means the task resembles tasks that were late before.",
        "Probabilities are not calibrated to current behaviour; the late rate has risen over time, so treat them as relative risk.",
        "Only two levels are reported (lower, higher); the data did not support three distinct risk levels.",
        "Based on lead time and the assignee's history only; other task details added little in testing.",
    ],
}
stats = {
    "snapshot_time": now,
    "target": target,
    "global": {"n": global_n, "late_rate": global_rate},
    "assignees": {str(k): {"n": int(v.n), "late": int(v.late)} for k, v in g.iterrows()},
}

out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
json.dump(params, open(out / "model_params.json", "w"), indent=2)
json.dump(stats, open(out / "assignee_stats.json", "w"), indent=2)
print("Wrote", out / "model_params.json", "and", out / "assignee_stats.json")
print(f"assignees: {len(g)} | labelled tasks: {global_n} | global late rate: {global_rate:.3f}")
print("coefficients:", dict(zip(cols, params['coefficients'])))
