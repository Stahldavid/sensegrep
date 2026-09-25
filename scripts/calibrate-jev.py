"""Offline feature selection. Python stdlib; optional --catboost for an installed CatBoost.
Input JSON rows: {group, split: dev|test, label: 0|1, features: {localScore, ...}}.
Use independently reviewed labels, never Jev's verdict as ground truth.
The untouched test partition is evaluated once, after grouped CV feature selection.
"""
import argparse
import hashlib
import json
import math
import statistics
from pathlib import Path


def sigmoid(x):
    return 1 / (1 + math.exp(-max(-30, min(30, x))))


def train(rows, names, steps=350):
    means = [statistics.mean(r["features"][n] for r in rows) for n in names]
    scales = [max(.01, statistics.pstdev(r["features"][n] for r in rows)) for n in names]
    vectors = [[1] + [(r["features"][n] - m) / s for n, m, s in zip(names, means, scales)] for r in rows]
    weights = [0.] * (len(names) + 1)
    for _ in range(steps):
        gradients = [0.] * len(weights)
        for r, x in zip(rows, vectors):
            error = sigmoid(sum(w * v for w, v in zip(weights, x))) - r["label"]
            for i, v in enumerate(x):
                gradients[i] += error * v
        weights = [w - .1 * (g / len(rows) + (.02 * w if i else 0)) for i, (w, g) in enumerate(zip(weights, gradients))]
    return {"features": names, "means": means, "scales": scales, "weights": weights}


def predict(model, rows):
    return [sigmoid(model["weights"][0] + sum(w * (r["features"][n] - m) / s
        for w, n, m, s in zip(model["weights"][1:], model["features"], model["means"], model["scales"]))) for r in rows]


def metrics(labels, probabilities):
    return {"brier": statistics.mean((p-y)**2 for p,y in zip(probabilities,labels)),
            "logLoss": -statistics.mean(y*math.log(max(1e-9,p))+(1-y)*math.log(max(1e-9,1-p)) for p,y in zip(probabilities,labels))}


def cv(rows, names):
    groups = sorted({r["group"] for r in rows}, key=lambda s: hashlib.sha256(s.encode()).hexdigest())
    folds = min(5, len(groups))
    results = []
    for fold in range(folds):
        held = set(groups[fold::folds])
        train_rows = [r for r in rows if r["group"] not in held]
        validation = [r for r in rows if r["group"] in held]
        model = train(train_rows, names)
        results.append(metrics([r["label"] for r in validation], predict(model, validation))["brier"])
    return statistics.mean(results)


def calibrate(rows, catboost=False):
    if not rows or any(r.get("label") not in (0, 1) or r.get("split") not in ("dev", "test") or not isinstance(r.get("group"), str) or not r["group"] for r in rows):
        raise ValueError("Every row requires an independently reviewed binary label, group, and explicit dev/test split")
    dev = [r for r in rows if r["split"] == "dev"]
    test = [r for r in rows if r["split"] == "test"]
    dev_groups, test_groups = {r["group"] for r in dev}, {r["group"] for r in test}
    if len(dev_groups) < 3 or not test_groups or dev_groups & test_groups:
        raise ValueError("Need at least three dev groups and an untouched, disjoint test group")
    names = sorted(set.intersection(*(set(r["features"]) for r in dev)))
    if any(n not in r["features"] for r in test for n in names):
        raise ValueError("Test schema must provide all development features; do not select features using test availability")
    if "localScore" not in names or any(not isinstance(r["features"][n], (int,float)) or not math.isfinite(r["features"][n]) for r in rows for n in names):
        raise ValueError("Finite common features including localScore required")
    selected, trials = ["localScore"], []
    best = cv(dev, selected)
    baseline_cv = best
    # Forward selection uses development groups only. Candidate fields are precomputed atomic decisions.
    remaining = [n for n in names if n not in selected]
    while remaining:
        trial = sorted((cv(dev, selected+[n]), n) for n in remaining)
        score, name = trial[0]
        accepted = score < best - .002
        trials.append({"feature": name, "cvBrier": score, "accepted": accepted,
                       "candidates": [{"feature": n, "cvBrier": s} for s, n in trial]})
        if not accepted:
            break
        selected.append(name); remaining.remove(name); best = score
    baseline, model = train(dev, ["localScore"]), train(dev, selected)
    labels = [r["label"] for r in test]
    result = {"schemaVersion": 1, "deploy": False, "labelSource": "independently-reviewed-input",
              "devGroups": len(dev_groups), "testGroups": len(test_groups), "baselineCvBrier": baseline_cv,
              "selectedCvBrier": best, "trials": trials, "model": model,
              "test": {"local": metrics(labels, predict(baseline,test)), "selected": metrics(labels,predict(model,test))},
              "warning": "Exploratory calibration only; no runtime activation or inference of semantic truth."}
    if catboost:
        from catboost import CatBoostClassifier
        cb = CatBoostClassifier(iterations=100, depth=3, learning_rate=.05, random_seed=1729, verbose=False, allow_writing_files=False)
        cb.fit([[r["features"][n] for n in selected] for r in dev], [r["label"] for r in dev])
        result["test"]["catboost"] = metrics(labels, cb.predict_proba([[r["features"][n] for n in selected] for r in test])[:,1].tolist())
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input"); parser.add_argument("output"); parser.add_argument("--catboost", action="store_true")
    args = parser.parse_args()
    data = json.loads(Path(args.input).read_text(encoding="utf-8"))
    result = calibrate(data, args.catboost)
    result["datasetSha256"] = hashlib.sha256(Path(args.input).read_bytes()).hexdigest()
    Path(args.output).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"features":result["model"]["features"],"test":result["test"],"deploy":False}))
