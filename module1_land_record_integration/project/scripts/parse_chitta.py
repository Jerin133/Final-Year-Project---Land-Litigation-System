#!/usr/bin/env python3
"""
parse_chitta.py
----------------
Parses a "FINAL CHITTA (RURAL)" PDF (Tamil Nadu revenue land record) into
two clean CSV tables:

    <village>_chitta_owners.csv   -> one row per (patta, owner)
    <village>_chitta_survey.csv   -> one row per (patta, survey/sub-division)

Usage:
    python3 parse_chitta.py <input_chitta.pdf> <village_name> <output_dir>

Example:
    python3 parse_chitta.py data/raw/achalvadi/chitta.pdf achalvadi data/processed/achalvadi
"""

import csv
import re
import subprocess
import sys
from pathlib import Path


def clean_tamil_text(text):
    """Remove artificial whitespace after virama (pulli) that pdftotext -layout
    inserts inside compound Tamil letters due to glyph-advance misreading.
    Only removes spaces that follow a virama character (\u0BCD) within a Tamil
    word; legitimate word-boundary spaces are preserved.
    """
    if not text or not isinstance(text, str):
        return text
    # Remove space after virama (\u0BCD) when followed by any Tamil character
    s = re.sub(r'(\u0BCD)\s+(?=[\u0B80-\u0BFF])', r'\1', text)
    # Remove stray space before a period in initials (e.g. "என் .குணசேகரன்" -> "என்.குணசேகரன்")
    s = re.sub(r'([\u0B80-\u0BFF])\s+\.', r'\1.', s)
    # Collapse multiple spaces into one and strip edges
    s = re.sub(r'\s+', ' ', s).strip()
    return s

PATTA_RE = re.compile(r"^\s*பட்டா\s*எண்\s*:\s*(\S+)")
FIELD_SECTION_MARK = "புல எண்"
TOTAL_MARK = "மொத்தம்"
OWNER_HEADER_MARK = "உறவினர்"
FIELD_HEADER_MARK = "உட்பிரிவு எண்"
SUBCOL_HEADER_MARK = "பரப்பு"  # sub-header row "பரப்பு தீர்வை பரப்பு தீர்வை பரப்பு தீர்வை"
FORM_FEED = "\x0c"

# Two different owner-table header formats show up across villages:
#   "... உறவினர் பெயர் | உறவு | உரிமையாளர் பெயர்"   (Achalvadi-style)
#   "... உறவு | உரிமையாளர்" (then "பெயர்" wraps onto its own line)
# "உரிமையாளர்" ("owner") appears in BOTH header variants and never inside
# an actual data row, so it's a reliable single marker regardless of
# which variant a village uses.
OWNER_HEADER_MARKERS = ("உறவினர்", "உரிமையாளர்")

# Known "உறவு" (relation) vocabulary seen in Tamil Nadu chitta records.
# "..." marks records with no personal relative (institutions, government
# bodies, temples). If you encounter a village where parsing drops owner
# rows, check for a relation word not in this list and add it here.
RELATION_VOCAB = ["மகன்", "மனைவி", "மகள்", "காப்பாளர்", "கணவர்", "கணவன்", "தந்தை", "தாய்",
                   "சகோதரர்", "சகோதரி", "பேரன்", "பேத்தி", r"\.\.\."]
RELATION_RE = re.compile(r"(?<!\S)(" + "|".join(RELATION_VOCAB) + r")(?!\S)")

# Numeric cell = "<acres> - <cents>" e.g. "0 - 9.00" (sometimes printed as
# "0 -9.00" with no space after the hyphen -- tolerate both). Each of the
# three land types (nanjai/punjai/other) gets its own uniquely-named group.
def _area_cell(prefix):
    return rf"(?P<{prefix}_ac>\d+)\s*-\s*(?P<{prefix}_ce>[\d.]+)"


FIELD_ROW_RE = re.compile(
    r"^\s*(?P<seq>\d+)\s+(?P<survey>\d+\s*-\s*\S+)\s+"
    rf"{_area_cell('n')}\s+(?P<n_tax>[\d.]+)\s+"
    rf"{_area_cell('p')}\s+(?P<p_tax>[\d.]+)\s+"
    rf"{_area_cell('o')}\s+(?P<o_tax>[\d.]+)\s+"
    r"(?P<remarks>.*)$"
)
TOTAL_ROW_RE = re.compile(
    rf"^\s*{TOTAL_MARK}\s+{_area_cell('n')}\s+(?P<n_tax>[\d.]+)\s+"
    rf"{_area_cell('p')}\s+(?P<p_tax>[\d.]+)\s+"
    rf"{_area_cell('o')}\s+(?P<o_tax>[\d.]+)\s+"
    r"(?P<remarks>.*)$"
)

# Same shape as FIELD_ROW_RE / TOTAL_ROW_RE, but for rows whose PUNJAI
# (dry-land) extent cell wrapped onto its own line and was stripped out
# by merge_wrapped_field_fragments() below -- p_ac/p_ce are absent here
# and get filled back in afterwards from the recovered fragment.
FIELD_ROW_RE_NO_PAREA = re.compile(
    r"^\s*(?P<seq>\d+)\s+(?P<survey>\d+\s*-\s*\S+)\s+"
    rf"{_area_cell('n')}\s+(?P<n_tax>[\d.]+)\s+"
    r"(?P<p_tax>[\d.]+)\s+"
    rf"{_area_cell('o')}\s+(?P<o_tax>[\d.]+)\s+"
    r"(?P<remarks>.*)$"
)
TOTAL_ROW_RE_NO_PAREA = re.compile(
    rf"^\s*{TOTAL_MARK}\s+{_area_cell('n')}\s+(?P<n_tax>[\d.]+)\s+"
    r"(?P<p_tax>[\d.]+)\s+"
    rf"{_area_cell('o')}\s+(?P<o_tax>[\d.]+)\s+"
    r"(?P<remarks>.*)$"
)

# Same shape again, but for rows whose SURVEY NUMBER / sub-division code
# wrapped onto its own line instead (long codes like "9B2A2B1B" push the
# whole survey column onto 2 lines the same way a long extent value does).
FIELD_ROW_RE_NO_SURVEY = re.compile(
    r"^\s*(?P<seq>\d+)\s+"
    rf"{_area_cell('n')}\s+(?P<n_tax>[\d.]+)\s+"
    rf"{_area_cell('p')}\s+(?P<p_tax>[\d.]+)\s+"
    rf"{_area_cell('o')}\s+(?P<o_tax>[\d.]+)\s+"
    r"(?P<remarks>.*)$"
)

# A wrapped cell (extent OR survey code) gets emitted by pdftotext -layout
# as three separate physical lines: the top half in its own line BEFORE
# the row, the row itself (missing that one cell), then the bottom half
# in its own line AFTER the row. The bottom half is either a decimal
# extent value ("29.50") or an alphanumeric subdivision code ("9B2A2B1B");
# we tell them apart later by whether it contains a ".".
FRAG_TOP_RE = re.compile(r"^(\d+)\s*-\s*$")
FRAG_BOTTOM_RE = re.compile(r"^([\dA-Za-z.]+)$")

# After a wrap, a row's remaining tail (tax/area columns) can *also* spill
# onto a further, separate physical line with no seq/TOTAL marker of its
# own (seen on total rows especially). Recognizes "does this line look
# like the start of a brand-new row" so a trailing fragment can be told
# apart from one.
ROW_OR_TOTAL_START_RE = re.compile(rf"^\s*(\d+\s|{TOTAL_MARK})")


def pdftotext_layout(pdf_path: str) -> str:
    """Run poppler's pdftotext -layout and return the text."""
    result = subprocess.run(
        ["pdftotext", "-layout", str(pdf_path), "-"],
        capture_output=True,
        encoding="utf-8",
        errors="replace"   # or "strict" if you want it to fail loudly on bad bytes
    )
    return result.stdout


def is_noise_line(line: str) -> bool:
    """Lines that are page headers/footers/timestamps, not data."""
    stripped = line.strip()
    if not stripped:
        return True
    if "about:blank" in stripped:
        return True
    if "FINAL CHITTA" in stripped:
        return True
    if stripped.startswith("District:"):
        return True
    if re.match(r"^\d+/\d+$", stripped):  # page counters like "1/237"
        return True
    return False


def is_owner_header_line(line: str) -> bool:
    if any(marker in line for marker in OWNER_HEADER_MARKERS):
        return True
    if line.strip() == "பெயர்":  # "பெயர்" ("Name") wraps onto its own line
        return True
    return False


ROW_START_CAPTURE_RE = re.compile(r"^(\s*\d+\s+\d+\s+)(.*)$")


def merge_owner_continuations(lines):
    """
    Owner / relative names too long for one printed line wrap onto a
    neighbouring physical line with no seq/sub-index prefix of their own
    -- sometimes the line ABOVE the row (a column value that started
    printing before the row's own baseline), sometimes the line BELOW
    (a column value continuing past it). Two passes:
      1. Attach a trailing continuation line onto the row above it.
      2. Attach a still-orphaned LEADING fragment onto the front of the
         next row's content (inserted right after its seq/sub-index, so
         it lands ahead of the relation word during matching).
    This guarantees no owner text is silently dropped, though for rows
    wrapped on BOTH sides the automatic relative-name/owner-name split
    can occasionally be imprecise -- see the note in main().
    """
    ROW_START_RE = re.compile(r"^\s*\d+\s+\d+\s+")
    merged = []
    for line in lines:
        if not line.strip():
            continue
        if not ROW_START_RE.match(line) and merged:
            merged[-1] = merged[-1] + " " + line.strip()
        else:
            merged.append(line)

    result = []
    pending = []
    for entry in merged:
        cap = ROW_START_CAPTURE_RE.match(entry)
        if not cap:
            pending.append(entry.strip())
            continue
        if pending:
            prefix, rest = cap.group(1), cap.group(2)
            entry = prefix + " ".join(pending) + " " + rest
            pending = []
        result.append(entry)
    if pending:
        result.extend(pending)  # no row followed -- leave for manual review
    return result


def merge_wrapped_field_fragments(lines):
    """
    Detects the "<n>-" / row / "<tail>" sandwich pattern described above
    and reattaches the fragments. Returns (line, recovered_or_None) pairs,
    where recovered is (ac, tail) -- caller decides whether tail is an
    extent value or a subdivision code based on whether it contains ".".
    """
    out = []
    i, n = 0, len(lines)
    while i < n:
        top_m = FRAG_TOP_RE.match(lines[i].strip())
        if top_m and i + 2 < n:
            bottom_m = FRAG_BOTTOM_RE.match(lines[i + 2].strip())
            if bottom_m:
                out.append((lines[i + 1], (top_m.group(1), bottom_m.group(1))))
                i += 3
                continue
        out.append((lines[i], None))
        i += 1
    return out


def merge_stray_field_tails(entries):
    """
    Runs after merge_wrapped_field_fragments(). A row's tail (tax/area
    columns after a wrap) can spill onto a further, separate physical
    line that has no seq number or TOTAL marker of its own. Glue any
    such orphan tail onto the row above it.
    """
    out = []
    for line, recovered in entries:
        stripped = line.strip()
        if out and stripped and not ROW_OR_TOTAL_START_RE.match(line):
            prev_line, prev_recovered = out[-1]
            out[-1] = (prev_line + " " + stripped, prev_recovered)
        else:
            out.append((line, recovered))
    return out


def _sum_area(rows, key):
    ac_total, ce_total = 0, 0.0
    for r in rows:
        ac, ce = r[key].split(" - ")
        ac_total += int(ac)
        ce_total += float(ce)
    return f"{ac_total} - {ce_total:.2f}"


def _sum_tax(rows, key):
    return f"{sum(float(r[key]) for r in rows):.2f}"


def parse_chitta(text: str, village: str):
    owners_rows = []
    survey_rows = []
    unparsed_owner_lines = []
    unparsed_field_lines = []

    # Drop noise lines and page breaks, keep everything else in document order
    lines = [l for l in text.split("\n") if not is_noise_line(l) and l.strip() != FORM_FEED]

    # Split the whole document into per-patta blocks
    patta_starts = []
    for i, line in enumerate(lines):
        m = PATTA_RE.match(line)
        if m:
            patta_starts.append((i, m.group(1)))
    patta_starts.append((len(lines), None))  # sentinel

    for (start_idx, patta_no), (end_idx, _) in zip(patta_starts, patta_starts[1:]):
        block = lines[start_idx + 1:end_idx]

        # Section 1: owners, until the "புல எண்" marker line
        section_break = None
        for i, line in enumerate(block):
            if FIELD_SECTION_MARK in line and OWNER_HEADER_MARK not in line:
                section_break = i
                break
        owner_lines = block[:section_break] if section_break is not None else block
        field_lines = block[section_break + 1:] if section_break is not None else []

        owner_lines_clean = [l for l in owner_lines if not is_owner_header_line(l)]
        owner_lines_merged = merge_owner_continuations(owner_lines_clean)

        for line in owner_lines_merged:
            stripped = line.strip()
            if not stripped:
                continue
            m = re.match(r"^\s*(\d+)\s+(\d+)\s+(.*)$", line)
            if not m:
                unparsed_owner_lines.append((patta_no, line))
                continue
            seq_no, sub_index, rest = m.group(1), m.group(2), m.group(3)
            rel_m = RELATION_RE.search(rest)
            if rel_m:
                relative_name = rest[:rel_m.start()].strip()
                relation = rel_m.group(1)
                owner_name = rest[rel_m.end():].strip()
            else:
                # No personal relation word (institution/government/temple
                # owner entries don't follow the "relative + relation +
                # owner" triple) -- keep the row instead of discarding a
                # structurally valid seq/sub-index entry.
                relative_name = ""
                relation = "(institution/no personal relation)"
                owner_name = rest.strip()
            owners_rows.append({
                "village": village,
                "patta_number": patta_no,
                "seq_no": seq_no,
                "sub_index": sub_index,
                "relative_name": clean_tamil_text(relative_name),
                "relation": clean_tamil_text(relation),
                "owner_name": clean_tamil_text(owner_name),
            })

        # Clean up field_lines BEFORE merging (blank/header lines could
        # otherwise get glued onto a data row by the stray-tail merge).
        field_lines_clean = [
            l for l in field_lines
            if l.strip() and FIELD_HEADER_MARK not in l and SUBCOL_HEADER_MARK not in l
        ]
        field_entries = merge_wrapped_field_fragments(field_lines_clean)
        field_entries = merge_stray_field_tails(field_entries)

        patta_field_rows = []   # this patta's non-total rows, for computing a total
        parsed_total_found = False

        for line, recovered in field_entries:
            is_total = line.strip().startswith(TOTAL_MARK)
            gd_extra = {}
            if is_total:
                m = TOTAL_ROW_RE.match(line)
                if not m and recovered:
                    ac, tail = recovered
                    if "." in tail:
                        m = TOTAL_ROW_RE_NO_PAREA.match(line)
                        if m:
                            gd_extra = {"p_ac": ac, "p_ce": tail}
            else:
                m = FIELD_ROW_RE.match(line)
                if not m and recovered:
                    ac, tail = recovered
                    if "." in tail:
                        m = FIELD_ROW_RE_NO_PAREA.match(line)
                        if m:
                            gd_extra = {"p_ac": ac, "p_ce": tail}
                    else:
                        m = FIELD_ROW_RE_NO_SURVEY.match(line)
                        if m:
                            gd_extra = {"survey": f"{ac} - {tail}"}

            if not m:
                unparsed_field_lines.append((patta_no, line))
                continue

            gd = m.groupdict()
            gd.update(gd_extra)

            survey_no, sub_division, seq_no = "", "", ""
            if not is_total:
                seq_no = gd["seq"]
                sm = re.match(r"^(\S+)\s*-\s*(\S+)$", gd["survey"])
                if sm:
                    survey_no, sub_division = sm.group(1), sm.group(2)

            row = {
                "village": village,
                "patta_number": patta_no,
                "seq_no": seq_no,
                "survey_subdivision_raw": "TOTAL" if is_total else gd["survey"],
                "survey_number": survey_no,
                "sub_division": sub_division,
                "is_total_row": is_total,
                "nanjai_area": f"{gd['n_ac']} - {gd['n_ce']}",
                "nanjai_tax": gd["n_tax"],
                "punjai_area": f"{gd['p_ac']} - {gd['p_ce']}",
                "punjai_tax": gd["p_tax"],
                "other_area": f"{gd['o_ac']} - {gd['o_ce']}",
                "other_tax": gd["o_tax"],
                "remarks": clean_tamil_text(gd["remarks"].strip()),
            }

            if is_total:
                parsed_total_found = True
            else:
                patta_field_rows.append(row)

            survey_rows.append(row)

        # If the printed மொத்தம் (total) row couldn't be parsed -- it's
        # sometimes rendered in a font pdftotext garbles, or split across
        # extra wrapped lines -- compute it ourselves instead. It's just
        # the sum of this patta's field rows, so we don't actually need
        # to depend on parsing the printed line at all.
        if not parsed_total_found and patta_field_rows:
            survey_rows.append({
                "village": village,
                "patta_number": patta_no,
                "seq_no": "",
                "survey_subdivision_raw": "TOTAL",
                "survey_number": "",
                "sub_division": "",
                "is_total_row": True,
                "nanjai_area": _sum_area(patta_field_rows, "nanjai_area"),
                "nanjai_tax": _sum_tax(patta_field_rows, "nanjai_tax"),
                "punjai_area": _sum_area(patta_field_rows, "punjai_area"),
                "punjai_tax": _sum_tax(patta_field_rows, "punjai_tax"),
                "other_area": _sum_area(patta_field_rows, "other_area"),
                "other_tax": _sum_tax(patta_field_rows, "other_tax"),
                "remarks": "(computed - printed total unreadable)",
            })

    unparsed = (
        [{"patta_number": p, "section": "owner", "raw_line": l.strip()} for p, l in unparsed_owner_lines]
        + [{"patta_number": p, "section": "field", "raw_line": l.strip()} for p, l in unparsed_field_lines]
    )
    return owners_rows, survey_rows, unparsed


def write_csv(rows, path: Path):
    if not rows:
        print(f"WARNING: no rows to write for {path}")
        return
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} rows -> {path}")


def main():
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(1)

    pdf_path, village, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    text = pdftotext_layout(pdf_path)
    owners_rows, survey_rows, unparsed = parse_chitta(text, village)

    n_pattas = len({r["patta_number"] for r in owners_rows} | {r["patta_number"] for r in survey_rows})
    print(f"Detected {n_pattas} patta blocks in {pdf_path}")

    write_csv(owners_rows, out_dir / f"{village}_chitta_owners.csv")
    write_csv(survey_rows, out_dir / f"{village}_chitta_survey.csv")

    if unparsed:
        affected_pattas = sorted(set(r["patta_number"] for r in unparsed), key=lambda x: (len(x), x))
        print(f"NOTE: {len(unparsed)} line(s) across {len(affected_pattas)} patta(s) need manual review "
              f"(long wrapped names/subdivision codes) -> see *_chitta_unparsed.csv. Affected patta numbers: "
              f"{affected_pattas}")
        write_csv(unparsed, out_dir / f"{village}_chitta_unparsed.csv")


if __name__ == "__main__":
    main()