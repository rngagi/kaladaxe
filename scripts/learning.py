"""Build the learning list from preserved source rows and explicit reviewed matches."""
import csv
import hashlib
import json
import re
from collections import Counter, defaultdict

PLACEHOLDERS = {"", "無此詞彙", "無", "-", "—", "N/A"}
RELATIONS = {"equivalent", "near", "broader", "narrower"}
LABELS = {"equivalent": "同義對應", "near": "近義對應", "broader": "來源詞義較廣", "narrower": "來源詞義較窄"}
PROTO_LANGS = {"pan": "19072", "pmp": "19081"}
FIELDS = ["variety_id", "entry_id", "gloss_zh", "orth", "note", "level", "file", "sheet", "row", "concept_ids"]


class LearningError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise LearningError("learning: " + message)


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as error:
        raise LearningError(f"{path}: {error}") from error


def relation(item):
    require(isinstance(item, dict) and item.get("relation") in RELATIONS, "對應關係不正確")
    require(isinstance(item.get("note"), str) and item["note"].strip(), "對應缺少說明")


def assemble(source, concepts, varieties):
    """Return index, per-entry payloads and review reports; never mutate sources.

    Synthetic/empty datasets can omit learning.csv. If present, all associated
    source files and the recorded row counts must validate before any publication.
    """
    path = source / "learning.csv"
    if not path.exists():
        return {"source": {}, "items": []}, {}, {"summary": {"entries": 0}}
    mapping = read_json(source / "import/learning_matches.json")
    archive = read_json(source / "import/learning_acd_records.json")
    require(isinstance(mapping, dict) and isinstance(mapping.get("entries"), dict), "缺少 entries 對應表")
    require(isinstance(archive, dict) and isinstance(archive.get("records"), list), "缺少 ACD records")
    require(mapping.get("source_sha256") == hashlib.sha256(path.read_bytes()).hexdigest(),
            "learning.csv 已變更，請覆核對應並更新 source_sha256")
    config = mapping["entries"]
    acd = {}
    for r in archive["records"]:
        require(isinstance(r, dict) and all(isinstance(r.get(k), str) and r[k].strip()
                for k in ("ID", "Language_ID", "Value", "Description")), "ACD 欄位不完整")
        require(r["ID"] not in acd, f'重複 ACD Form ID {r["ID"]}')
        require(r["Language_ID"] in PROTO_LANGS.values() and r["Value"].startswith("*"), "ACD 必須是帶星號的 PAn/PMP 來源")
        require(r.get("Doubt") != "true" and r.get("Sic") != "true", "ACD 來源有疑義標記")
        acd[r["ID"]] = r
    modern = [v["id"] for v in varieties if v["type"] != "proto"]
    order = {vid: i for i, vid in enumerate(modern)}
    concept_ids = {c["id"] for c in concepts["items"]}
    vi = {v["id"] for v in varieties}
    by_entry = defaultdict(list)
    pairs = {}
    try:
        with path.open(encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream, strict=True)
            require(reader.fieldnames == FIELDS, "learning.csv 表頭不正確")
            for row in reader:
                require(None not in row and all(v is not None for v in row.values()), f"第 {reader.line_num} 列欄位數不正確")
                eid, vid = row["entry_id"], row["variety_id"]
                require(re.fullmatch(r"\d{2}-\d{2,3}", eid) is not None and all(int(p) > 0 for p in eid.split("-")), f"編號不正確 {eid}")
                require(vid in order, f"未知語言別 {vid}")
                require((eid, vid) not in pairs, f"重複組合 {eid} × {vid}")
                require(row["gloss_zh"].strip() and row["file"].strip() and row["sheet"].strip()
                        and row["row"].isdigit() and int(row["row"]) > 0, f"來源欄位不完整 {eid} × {vid}")
                pairs[eid, vid] = row
                by_entry[eid].append(row)
    except (OSError, UnicodeError, csv.Error) as error:
        raise LearningError(f"{path}: {error}") from error
    require(len(pairs) == mapping.get("expected_rows"), "原始列數不符")
    require(len(by_entry) == mapping.get("expected_entries"), "編號數量不符")
    require(set(by_entry) == set(config), "對應表必須涵蓋所有學習詞表編號")
    items, words, provenance, additions, near, missing, variants = [], {}, [], [], [], [], []
    coverage = Counter({v["id"]: 0 for v in varieties})
    used_acd = set()
    for eid in sorted(by_entry, key=lambda x: tuple(map(int, x.split("-")))):
        rows = sorted(by_entry[eid], key=lambda r: order[r["variety_id"]])
        require({r["variety_id"] for r in rows} == set(modern), f"語言別不完整 {eid}")
        e = config[eid]
        require(isinstance(e, dict) and isinstance(e.get("concepts"), list)
                and isinstance(e.get("proto"), dict) and set(e["proto"]) == set(PROTO_LANGS)
                and isinstance(e.get("supplements"), list), f"對應欄位不完整 {eid}")
        gloss = Counter(r["gloss_zh"] for r in rows).most_common(1)[0][0]
        require(e.get("gloss_zh") == gloss and isinstance(e.get("gloss_en"), str), f"詞義不符 {eid}")
        aliases = list(dict.fromkeys(r["gloss_zh"] for r in rows))
        linked = set()
        for link in e["concepts"]:
            relation(link)
            cid = link.get("concept_id")
            require(cid in concept_ids and cid not in linked, f"未知或重複概念 {eid}: {cid}")
            linked.add(cid)
        items.append(dict(id=eid, entry_id=eid, gloss_zh=gloss, gloss_en=e["gloss_en"],
                          aliases=aliases, concept_ids=[c["concept_id"] for c in e["concepts"]]))
        if len(aliases) > 1:
            variants.append(dict(entry_id=eid, gloss_zh=gloss, variants=[dict(variety_id=r["variety_id"], gloss_zh=r["gloss_zh"]) for r in rows]))
        forms = {}

        def excel_form(row, match=None):
            record = {k: row[k] for k in ("entry_id", "variety_id", "gloss_zh", "orth", "note", "level", "file", "sheet", "row")}
            record.update(source_type="excel", target_entry_id=eid,
                          relation=match["relation"] if match else "original")
            prefix = (LABELS[match["relation"]] + "：" + match["note"] + "\n") if match else ""
            note = (prefix + f'2026學習詞表 {row["entry_id"]}「{row["gloss_zh"]}」'
                    + (f'（{row["level"]}）' if row["level"] else "")
                    + f'\n來源：{row["file"]}／{row["sheet"]}／第 {row["row"]} 列'
                    + ("\n" + row["note"] if row["note"] else ""))
            provenance.append(record)
            return dict(orth=row["orth"], ipa="", note=note, source_gloss=row["gloss_zh"], sources=[record])

        for row in rows:
            if row["orth"].strip() not in PLACEHOLDERS:
                forms[row["variety_id"]] = excel_form(row)
        supplemented = set()
        for match in e["supplements"]:
            relation(match)
            vid = match.get("variety_id")
            original = pairs.get((match.get("entry_id"), vid))
            require(vid in order and vid not in forms and vid not in supplemented,
                    f"補入不得覆寫現有詞形或跨語言別 {eid}: {vid}")
            require(original is not None and original["orth"].strip() not in PLACEHOLDERS, f"補入來源缺漏 {eid}")
            forms[vid] = excel_form(original, match)
            supplemented.add(vid)
            record = dict(forms[vid]["sources"][0], entry_id=eid, source_entry_id=original["entry_id"],
                          source_gloss=original["gloss_zh"], match_note=match["note"])
            additions.append(record)
            if match["relation"] != "equivalent":
                near.append(record)
        for lang in PROTO_LANGS:
            require(isinstance(e["proto"][lang], list), f"祖語對應須為陣列 {eid}")
            if lang not in vi:
                require(not e["proto"][lang], f"對應祖語不存在 {lang}")
                continue
            selected = e["proto"][lang]
            records, notes, orths = [], [], []
            seen = set()
            for match in selected:
                relation(match)
                fid = match.get("form_id")
                require(fid in acd and fid not in seen, f"未知或重複 ACD Form ID {eid}: {fid}")
                seen.add(fid)
                used_acd.add(fid)
                r = acd[fid]
                source_lang = lang
                require(r["Language_ID"] == PROTO_LANGS[source_lang], f"ACD 語言層級不符 {eid}: {fid}")
                record = dict(entry_id=eid, variety_id=lang, source_type="acd", source_id=fid,
                              orth=r["Value"], source_gloss=r["Description"], relation=match["relation"],
                              match_note=match["note"], fallback_from="")
                records.append(record)
                provenance.append(record)
                additions.append(record)
                if match["relation"] != "equivalent":
                    near.append(record)
                notes.append(f'{LABELS[match["relation"]]}：{match["note"]}\nACD {source_lang.upper()} Form ID: {fid}')
                if r["Value"] not in orths:
                    orths.append(r["Value"])
            if records:
                forms[lang] = dict(orth=" / ".join(orths), ipa="",
                                   note="\n\n".join(notes),
                                   source_gloss=" / ".join(dict.fromkeys(r["source_gloss"] for r in records)), sources=records)
        for v in varieties:
            vid = v["id"]
            if vid in forms:
                coverage[vid] += 1
            else:
                missing.append(dict(entry_id=eid, gloss_zh=gloss, variety_id=vid,
                                    reason="原表缺項" if vid in order else "未確認祖語來源"))
        words[eid] = dict(concept_id=eid, entry_id=eid, forms=forms)
    require(used_acd == set(acd), "ACD 來源摘錄含未使用記錄，請清理或補齊對應")
    summary = dict(entries=len(items), modern_varieties=len(modern), original_rows=len(pairs),
                   original_missing=sum(r["orth"].strip() in PLACEHOLDERS for r in pairs.values()),
                   modern_supplements=sum(len(e["supplements"]) for e in config.values()),
                   acd_records=len(used_acd), reviewed_acd_records=mapping.get("reviewed_acd_records"),
                   forms=sum(coverage.values()), coverage=dict(coverage), missing=len(missing),
                   variant_entries=len(variants), near_matches=len(near),
                   pan_fallbacks=sum("pmp" in w["forms"] and bool(w["forms"]["pmp"]["sources"][0]["fallback_from"]) for w in words.values()))
    index = dict(source=dict(version="2026年學習詞表", mapping_version=mapping.get("version")), items=items)
    reports = dict(summary=summary, additions=additions, near_matches=near, missing=missing,
                   gloss_variants=variants, concept_matches=config, sources=provenance)
    return index, words, reports
