"""Import the supplied learning workbooks and curated ACD concept matches.

Requires openpyxl for reading XLSX; routine builds still use the standard library.
Mapping files in source/import are editable. Re-running replaces generated CSVs;
use --out with a separate directory to review a fresh import before manual edits.
"""
import argparse
import ast
from collections import defaultdict, Counter
import csv
import hashlib
import json
from pathlib import Path
import re
import openpyxl

ROOT = Path(__file__).resolve().parents[1]
MAPPING = ROOT / "source/import"
PROTO_LANGS = {"pan": "19072", "pmp": "19081"}
PLACEHOLDERS = {"無此詞彙", "無", "-", "—", "N/A"}

def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))

def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def write_csv(path, fields, rows):
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)

def klokah_codes(path):
    # Read dictionary literals without importing or executing the source project.
    tree = ast.parse(path.read_text(encoding="utf-8"))
    tables = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Attribute) and target.attr in ("dialect_names", "dialect_mapping"):
                    tables[target.attr] = ast.literal_eval(node.value)
    return tables["dialect_names"], tables["dialect_mapping"]

def import_data(excel_dir, acd_dir, klokah_dir, out):
    out.mkdir(parents=True, exist_ok=True)
    concepts = read_json(ROOT / "source/concepts.json")["items"]
    concept_ids = {c["id"] for c in concepts}
    aliases = read_json(MAPPING / "excel_glosses.json")
    assert set(aliases) == concept_ids
    by_gloss = defaultdict(list)
    for concept, glosses in aliases.items():
        for gloss in glosses:
            by_gloss[gloss].append(concept)
    names, codes = klokah_codes(klokah_dir / "commands/kl.py")
    name_to_id = {name: code for code, name in names.items()}
    seen = set()
    corpus, sources = [], []
    hashes = {}
    for path in sorted(excel_dir.glob("*.xlsx")):
        name = re.sub(r"^2026學習詞表-\d+", "", path.stem)
        variety = name_to_id[name]
        assert variety not in seen, variety
        seen.add(variety)
        hashes[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
        workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
        for sheet in workbook:
            for number, cells in enumerate(sheet.values, 1):
                if len(cells) < 4 or not cells[1] or not cells[2] or not str(cells[1])[0].isdigit():
                    continue
                gloss = str(cells[2]).strip()
                orth = str(cells[3] or "").strip()
                matched = by_gloss.get(gloss, []) if orth and orth not in PLACEHOLDERS else []
                entry = dict(variety_id=variety, entry_id=str(cells[1]), gloss_zh=gloss, orth=orth,
                             note=str(cells[4] or ""), level=str(cells[5] or ""),
                             file=path.name, sheet=sheet.title, row=number, concept_ids=";".join(matched))
                corpus.append(entry)
                for concept in matched:
                    sources.append(dict(concept_id=concept, variety_id=variety, orth=orth, source_type="excel",
                                        source_id=entry["entry_id"], source_gloss=gloss, source_level="",
                                        file=path.name, sheet=sheet.title, row=number, source_note=entry["note"],
                                        fallback_from=""))
        workbook.close()
    assert seen == set(names) and len(seen) == 42, seen
    forms_path = acd_dir / "cldf/forms.csv"
    hashes["acd-2.0/cldf/forms.csv"] = hashlib.sha256(forms_path.read_bytes()).hexdigest()
    with forms_path.open(encoding="utf-8", newline="") as stream:
        acd = {r["ID"]: r for r in csv.DictReader(stream)}
    selected = read_json(MAPPING / "acd_forms.json")
    assert set(selected) == concept_ids
    for concept, levels in selected.items():
        for variety, language_id in PROTO_LANGS.items():
            form_ids = levels[variety]
            fallback = variety == "pmp" and not form_ids and bool(levels["pan"])
            if fallback:
                form_ids = levels["pan"]
            for form_id in form_ids:
                form = acd[form_id]
                level = "pan" if fallback else variety
                assert form["Language_ID"] == PROTO_LANGS[level], (concept, form_id)
                # Value preserves the ACD reconstruction marker and transcription.
                orth = form["Value"]
                assert orth.startswith("*"), (concept, form_id, orth)
                sources.append(dict(concept_id=concept, variety_id=variety, orth=orth, source_type="acd",
                                    source_id=form_id, source_gloss=form["Description"], source_level=level,
                                    file="acd-2.0/cldf/forms.csv", sheet="", row="", source_note=form["Source"],
                                    fallback_from="pan" if fallback else ""))
    by_pair = defaultdict(list)
    for row in sources:
        by_pair[row["concept_id"], row["variety_id"]].append(row)
    words = []
    for concept in concepts:
        for variety in list(names) + ["pan", "pmp"]:
            entries = by_pair[concept["id"], variety]
            if not entries:
                continue
            orth = " / ".join(dict.fromkeys(e["orth"] for e in entries))
            notes = []
            for e in entries:
                if e["source_type"] == "excel":
                    note = f"2026學習詞表 {e['source_id']}「{e['source_gloss']}」"
                    if e["source_note"]:
                        note += "：" + e["source_note"]
                else:
                    prefix = "PMP 缺項，複製 PAn；" if e["fallback_from"] else ""
                    note = f"{prefix}ACD {e['source_level'].upper()} {e['source_id']}「{e['source_gloss']}」"
                if note not in notes:
                    notes.append(note)
            words.append(dict(concept_id=concept["id"], variety_id=variety, orth=orth, ipa="", note="；".join(notes)))
    write_csv(out / "learning.csv", list(corpus[0]), corpus)
    write_csv(out / "word_sources.csv", list(sources[0]), sources)
    write_csv(out / "swadesh.csv", ["concept_id", "variety_id", "orth", "ipa", "note"], words)
    present = {(r["concept_id"], r["variety_id"]) for r in words}
    write_csv(out / "missing.csv", ["concept_id", "variety_id"], [
        dict(concept_id=c["id"], variety_id=v) for c in concepts for v in list(names) + ["pan", "pmp"]
        if (c["id"], v) not in present])
    coverage = dict(Counter(r["variety_id"] for r in words))
    write_json(out / "import_summary.json", dict(concepts=len(concepts), varieties=42, excel_rows=len(corpus),
               mapped_excel_rows=sum(bool(r["concept_ids"]) for r in corpus),
               forms=len(words), coverage=coverage,
               pmp_fallback_concepts=sorted({r["concept_id"] for r in sources if r["fallback_from"]}),
               source_sha256=hashes))
    print(json.dumps(dict(rows=len(corpus), forms=len(words), coverage=coverage), ensure_ascii=False))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--excel-dir", type=Path, required=True)
    parser.add_argument("--acd-dir", type=Path, required=True)
    parser.add_argument("--klokah-dir", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=ROOT / "source")
    args = parser.parse_args()
    import_data(args.excel_dir, args.acd_dir, args.klokah_dir, args.out)
