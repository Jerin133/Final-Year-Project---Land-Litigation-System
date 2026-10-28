"""
Land-record features for the risk module  (OPTIONAL plug-in point).

The risk models learn from whatever numeric columns this function returns.
Every key MUST start with "land_" and every value must be a number
(use 0/1 for yes/no flags).  Keys you return become model inputs
automatically - nothing else needs to change.  Cases for which you return
{} (or which lack a key) get the training-set median for that column.

Right now it returns {} because the Module 1 (Chitta / A-Register / FMB)
data is not part of the Module 2 code base.  Connect it like this:

    from module1.lookup import get_land_record      # <- your Module 1 call

    def get_land_features(survey_no, subdivision):
        rec = get_land_record(survey_no, subdivision)
        if not rec:
            return {}
        return {
            "land_area_acres":       float(rec.area_acres),
            "land_owner_count":      len(rec.owners),
            "land_patta_mismatch":   1.0 if rec.patta_holder != rec.chitta_holder else 0.0,
            "land_natham":           1.0 if rec.is_natham else 0.0,
        }

Keep it fast (it is called once per case when the models are trained).
"""
from __future__ import annotations


def get_land_features(survey_no, subdivision) -> dict:
    return {}