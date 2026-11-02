"""
Regenerate tests/parity.json from YOUR trained model, so the parity test checks the exported
JavaScript model against the scikit-learn model you actually exported.

Run it in Colab (or anywhere scikit-learn can open the .joblib file), then copy parity.json into tests/:

    python make_parity_fixture.py --artifact /content/output/overdue_risk_model.joblib \
                                  --features /content/output/features_all_tasks.csv --out parity.json
"""
import argparse, json

import joblib
import pandas as pd

ap = argparse.ArgumentParser()
ap.add_argument("--artifact", default="/content/output/overdue_risk_model.joblib")
ap.add_argument("--features", default="/content/output/features_all_tasks.csv")
ap.add_argument("--out", default="parity.json")
ap.add_argument("--n", type=int, default=30)
args = ap.parse_args()

art = joblib.load(args.artifact)
f = pd.read_csv(args.features).dropna(subset=["lead_days_log", "asg_late_rate"])
f = f.sample(min(args.n, len(f)), random_state=1)
p = art["model"].predict_proba(f[art["features"]])[:, 1]
rows = [{"lead_days_log": float(a), "asg_late_rate": float(b), "expected": float(c)}
        for a, b, c in zip(f["lead_days_log"], f["asg_late_rate"], p)]
json.dump({"note": "expected = scikit-learn predict_proba of the exported model", "rows": rows}, open(args.out, "w"), indent=1)
print(f"Wrote {len(rows)} rows to {args.out}")
