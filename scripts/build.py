#!/usr/bin/env python3
"""Validate editorial data and assemble a standalone static Pages artifact."""
import argparse
import csv
import json
import math
import re
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ID = re.compile(r"[a-z][a-z0-9_]*\Z")
CSV_FIELDS = ["concept_id", "variety_id", "orth", "ipa", "note"]
BUILD_MARKER = ".kaladaxe-build"


class DataError(ValueError):
    pass


def require(condition, where, message):
    if not condition:
        raise DataError(f"{where}: {message}")


def nonblank(value):
    return isinstance(value, str) and bool(value.strip())


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as error:
        raise DataError(f"{path}: {error}") from error


def index_items(items, where, fields):
    require(isinstance(items, list), where, "必須是陣列")
    result = {}
    for i, item in enumerate(items):
        at = f"{where}[{i}]"
        require(isinstance(item, dict), at, "必須是物件")
        for field in fields:
            require(field in item, at, f"缺少欄位 {field}")
        key = item.get("id")
        require(isinstance(key, str) and ID.fullmatch(key), at, "id 必須符合 [a-z][a-z0-9_]*")
        require(key not in result, at, f"重複 id {key}")
        result[key] = item
    return result


def validate(source):
    source = Path(source)
    concepts = read_json(source / "concepts.json")
    where = str(source / "concepts.json")
    require(isinstance(concepts, dict), where, "必須包含 source 與 items 的物件")
    require(isinstance(concepts.get("source"), dict), where, "缺少來源資訊 source")
    ci = index_items(concepts.get("items"), where, ["id", "swadesh_number", "gloss_en", "gloss_zh"])
    numbers = set()
    for key, item in ci.items():
        at = f"{where} ({key})"
        n = item["swadesh_number"]
        require(type(n) is int and n > 0, at, "swadesh_number 必須為正整數")
        require(n not in numbers, at, f"重複 swadesh_number {n}")
        numbers.add(n)
        for field in ("gloss_en", "gloss_zh"):
            require(nonblank(item[field]), at, f"{field} 不可空白")
    concepts = dict(concepts, items=sorted(ci.values(), key=lambda item: item["swadesh_number"]))
    varieties = read_json(source / "varieties.json")
    groups = read_json(source / "subgroups.json")
    vi = index_items(varieties, str(source / "varieties.json"),
                     ["id", "name", "native_name", "type", "subgroup_id", "latitude", "longitude"])
    gi = index_items(groups, str(source / "subgroups.json"), ["id", "name", "parent_id"])
    for key, group in gi.items():
        at = f"{source / 'subgroups.json'} ({key})"
        require(nonblank(group["name"]), at, "name 不可空白")
        parent = group["parent_id"]
        require(parent is None or (isinstance(parent, str) and parent in gi), at, f"未知 parent_id {parent}")
        proto = group.get("proto_variety_id")
        require(proto is None or (isinstance(proto, str) and proto in vi), at, f"未知 proto_variety_id {proto}")
        if proto is not None:
            require(vi[proto]["type"] == "proto" and vi[proto]["subgroup_id"] == key,
                    at, f"proto_variety_id {proto} 必須是指回此群的 proto")
    # Iterative walk avoids recursion limits for editorial classification depth.
    for key in gi:
        seen = set()
        node = key
        while node is not None:
            require(node not in seen, str(source / "subgroups.json"), f"分類循環：{key} → {node}")
            seen.add(node)
            node = gi[node]["parent_id"]
    if gi:
        require(sum(g["parent_id"] is None for g in gi.values()) == 1,
                str(source / "subgroups.json"), "非空分類樹必須有一個根節點")
    for key, variety in vi.items():
        at = f"{source / 'varieties.json'} ({key})"
        require(nonblank(variety["name"]), at, "name 不可空白")
        require(variety["native_name"] is None or nonblank(variety["native_name"]),
                at, "native_name 必須是文字或 null")
        require(variety["type"] in ("language", "dialect", "proto"), at, "未知 type")
        group = variety["subgroup_id"]
        require(isinstance(group, str) and group in gi, at, f"未知 subgroup_id {group}")
        for field, bound in (("latitude", 90), ("longitude", 180)):
            value = variety[field]
            require(type(value) in (int, float) and math.isfinite(value) and -bound <= value <= bound,
                    at, f"{field} 必須是介於 {-bound} 與 {bound} 的有限數字")
        for field in ("iso639_3", "glottocode", "location_note"):
            require(variety.get(field) is None or isinstance(variety[field], str),
                    at, f"{field} 必須是文字或 null")
    words = {key: {"concept_id": key, "forms": {}} for key in ci}
    path = source / "swadesh.csv"
    try:
        with path.open(encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream, strict=True)
            require(reader.fieldnames == CSV_FIELDS, str(path),
                    "表頭必須是 " + ",".join(CSV_FIELDS))
            for row in reader:
                at = f"{path}:{reader.line_num}"
                require(None not in row and all(v is not None for v in row.values()),
                        at, "資料列欄位數與表頭不符")
                concept, variety = row["concept_id"], row["variety_id"]
                require(concept in ci, at, f"未知 concept_id {concept}")
                require(variety in vi, at, f"未知 variety_id {variety}")
                require(variety not in words[concept]["forms"], at,
                        f"重複組合 {concept} × {variety}")
                for field in ("orth", "ipa"):
                    require(nonblank(row[field]), at, f"{field} 不可空白")
                words[concept]["forms"][variety] = {field: row[field] for field in ("orth", "ipa", "note")}
    except (OSError, UnicodeError, csv.Error) as error:
        line = getattr(locals().get("reader"), "line_num", 0)
        raise DataError(f"{path}:{line}: {error}") from error
    return concepts, varieties, groups, words


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def build(source=ROOT / "source", output=ROOT / "dist"):
    source, output = Path(source).resolve(), Path(output).resolve()
    protected = [ROOT / name for name in ("source", "site", "scripts", "tests", "templates", ".git", "stitch_kaladaxe")]
    protected.append(source)
    require(output != ROOT and output not in ROOT.parents, str(output), "輸出不可覆寫專案或其上層目錄")
    for path in protected:
        require(output != path and path not in output.parents and output not in path.parents,
                str(output), f"輸出與來源／專案資料重疊：{path}")
    if output.exists():
        require(output.is_dir() and (output / BUILD_MARKER).is_file(), str(output),
                "拒絕覆寫未標記的目錄；請使用新的輸出目錄")
    concepts, varieties, groups, words = validate(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".kaladaxe-", dir=output.parent))
    try:
        shutil.copytree(ROOT / "site", staging, dirs_exist_ok=True)
        data = staging / "data"
        (data / "words").mkdir(parents=True)
        for name, value in (("concepts", concepts), ("varieties", varieties), ("subgroups", groups)):
            write_json(data / f"{name}.json", value)
        for key, word in words.items():
            word["forms"] = dict(sorted(word["forms"].items()))
            write_json(data / "words" / f"{key}.json", word)
        index = staging / "index.html"
        html = index.read_text(encoding="utf-8")
        notice = '<aside class="test-banner">合成測試資料 · 僅供功能驗證，不代表真實語言資料</aside>' if concepts.get("test_data") is True else ""
        index.write_text(html.replace("<!--BUILD_NOTICE-->", notice), encoding="utf-8")
        (staging / ".nojekyll").touch()
        (staging / BUILD_MARKER).write_text("Generated by scripts/build.py\n", encoding="utf-8")
        if output.exists():
            shutil.rmtree(output)
        staging.replace(output)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return len(words), sum(len(word["forms"]) for word in words.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "source")
    parser.add_argument("--out", type=Path, default=ROOT / "dist")
    parser.add_argument("--check", action="store_true", help="僅驗證，不輸出檔案")
    args = parser.parse_args()
    try:
        if args.check:
            validate(args.source)
            print("資料驗證通過")
        else:
            count, forms = build(args.source, args.out)
            print(f"建置完成：{count} 個概念，{forms} 筆詞彙 → {args.out}")
    except (DataError, OSError) as error:
        print(f"建置失敗：{error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
