"""
DEV-ONLY accuracy check. Compares what the extractor reads out of the PDFs
against data_case_index_paragraph_style.csv, the answer key that was used
to *generate* this synthetic batch. The running app never reads this file;
it exists purely to prove the extractor's accuracy during development.

Run: python3 dev_validation/validate.py
"""
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd  # noqa: E402

from app.index_builder import build_index  # noqa: E402

BASE = Path(__file__).resolve().parents[1]
ANSWER_KEY = Path(__file__).resolve().parent / "answer_key_DEV_ONLY.csv"


def ddmmyyyy_to_iso(s):
    if not s:
        return None
    try:
        return datetime.strptime(s, "%d.%m.%Y").strftime("%Y-%m-%d")
    except ValueError:
        return s


def main():
    records, by_id, warnings = build_index(BASE / "data/pdf/english", BASE / "data/pdf/tamil")
    key = pd.read_csv(ANSWER_KEY, dtype=str).fillna("")
    key = key.set_index("case_id")

    fields = ["survey_no", "subdivision", "filing_date", "status", "dispute_type",
              "hearing_count", "adjournment_count", "appeal_indicator",
              "disposal_date", "court", "petitioner", "respondent"]
    total = {f: 0 for f in fields}
    correct = {f: 0 for f in fields}
    mismatches = []

    for rec in records:
        if rec.case_id not in key.index:
            mismatches.append((rec.case_id, "case_id", "NOT IN ANSWER KEY", ""))
            continue
        k = key.loc[rec.case_id]
        got = {
            "survey_no": str(rec.survey_no),
            "subdivision": rec.subdivision,
            "filing_date": ddmmyyyy_to_iso(rec.filing_date),
            "status": rec.status_en,
            "dispute_type": rec.dispute_type_en,
            "hearing_count": str(rec.hearing_count),
            "adjournment_count": str(rec.adjournment_count),
            "appeal_indicator": str(rec.appeal_indicator),
            "disposal_date": ddmmyyyy_to_iso(rec.disposal_date) or "",
            "court": rec.court,
            "petitioner": rec.petitioner_name,
            "respondent": rec.respondent_name,
        }
        want = {
            "survey_no": str(int(k.survey_no)),
            "subdivision": k.subdivision,
            "filing_date": k.filing_date,
            "status": k.status,
            "dispute_type": k.dispute_type,
            "hearing_count": str(int(k.hearing_count)),
            "adjournment_count": str(int(k.adjournment_count)),
            "appeal_indicator": str(k.appeal_indicator == "True"),
            "disposal_date": k.disposal_date,
            "court": k.court,
            "petitioner": k.petitioner,
            "respondent": k.respondent,
        }
        for f in fields:
            total[f] += 1
            if got[f] == want[f]:
                correct[f] += 1
            else:
                mismatches.append((rec.case_id, f, want[f], got[f]))

    print(f"{'FIELD':22s} {'CORRECT':>8s} / {'TOTAL':<6s} ACCURACY")
    overall_correct = overall_total = 0
    for f in fields:
        acc = correct[f] / total[f] * 100 if total[f] else 0
        overall_correct += correct[f]
        overall_total += total[f]
        print(f"{f:22s} {correct[f]:8d} / {total[f]:<6d} {acc:6.1f}%")
    print("-" * 55)
    print(f"{'OVERALL':22s} {overall_correct:8d} / {overall_total:<6d} "
          f"{overall_correct/overall_total*100:6.1f}%")

    if mismatches:
        print(f"\n{len(mismatches)} mismatches (showing up to 30):")
        for case_id, f, want, got in mismatches[:30]:
            print(f"  {case_id:16s} {f:16s} want={want!r:30s} got={got!r}")

    print(f"\nrecords indexed: {len(records)}   index warnings: {len(warnings)}")
    for w in warnings[:20]:
        print("  -", w)


if __name__ == "__main__":
    main()
