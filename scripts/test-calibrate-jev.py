import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("calibration", Path(__file__).with_name("calibrate-jev.py"))
calibration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(calibration)

class CalibrationTest(unittest.TestCase):
    def rows(self):
        return [{"group": f"g{g}", "split": "test" if g==4 else "dev", "label": i%2,
                 "features":{"localScore":.5,"evidence":float(i%2),"noise":float(i%3)}}
                for g in range(5) for i in range(8)]

    def test_selects_independent_signal(self):
        result=calibration.calibrate(self.rows())
        self.assertIn("evidence",result["model"]["features"])
        self.assertLess(result["test"]["selected"]["brier"],result["test"]["local"]["brier"])
        self.assertFalse(result["deploy"])

    def test_test_labels_never_select_features(self):
        rows=self.rows(); first=calibration.calibrate(rows)
        for row in rows:
            if row["split"]=="test": row["label"]=1-row["label"]
        second=calibration.calibrate(rows)
        self.assertEqual(first["model"],second["model"])
        self.assertEqual(first["trials"],second["trials"])

    def test_rejects_group_leakage_and_unlabelled_samples(self):
        rows=self.rows(); rows[-1]["group"]="g0"
        with self.assertRaises(ValueError): calibration.calibrate(rows)
        rows=self.rows(); rows[0]["label"]=None
        with self.assertRaises(ValueError): calibration.calibrate(rows)

if __name__=="__main__": unittest.main()
