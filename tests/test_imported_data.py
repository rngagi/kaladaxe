import csv
import json
import unittest
from collections import Counter
from scripts.build import ROOT, validate

class ImportedDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.concepts, cls.varieties, _, cls.words = validate(ROOT / "source")
        with (ROOT / "source/word_sources.csv").open(encoding="utf-8", newline="") as f:
            cls.sources = list(csv.DictReader(f))

    def test_42_klokah_codes_and_requested_proto_positions(self):
        modern = [v for v in self.varieties if v["type"] != "proto"]
        self.assertEqual(len(modern), 42)
        self.assertEqual({v["klokah_number"] for v in modern}, set(range(1, 44)) - {12})
        self.assertTrue(all(v["id"] == v["klokah_code"] for v in modern))
        by_id = {v["id"]: v for v in self.varieties}
        self.assertEqual((by_id["pan"]["latitude"], by_id["pan"]["longitude"]), (23.04, 120.31))
        self.assertEqual((by_id["pmp"]["latitude"], by_id["pmp"]["longitude"]), (22.75, 121.20))

    def test_all_workbooks_preserved_and_sentinels_excluded(self):
        with (ROOT / "source/learning.csv").open(encoding="utf-8", newline="") as f:
            corpus = list(csv.DictReader(f))
        self.assertEqual(len(corpus), 45948)
        self.assertEqual(len({r["file"] for r in corpus}), 42)
        self.assertEqual(sum(r["orth"] == "無此詞彙" for r in corpus), 188)
        indexed = {(r["file"], r["sheet"], r["row"]): r for r in corpus}
        for source in self.sources:
            if source["source_type"] == "excel":
                original = indexed[source["file"], source["sheet"], source["row"]]
                self.assertEqual(source["orth"], original["orth"])
                self.assertEqual(source["source_gloss"], original["gloss_zh"])
                self.assertIn(source["concept_id"], original["concept_ids"].split(";"))
        self.assertFalse(any("無此詞彙" in f["orth"] for w in self.words.values() for f in w["forms"].values()))

    def test_numbers_and_common_body_parts_have_all_modern_varieties(self):
        ids = {v["id"] for v in self.varieties if v["type"] != "proto"}
        for concept in "one two three four five six seven eight nine ten twenty hundred tongue eye ear nose hand".split():
            self.assertTrue(ids <= self.words[concept]["forms"].keys(), concept)
        self.assertEqual(self.words["one"]["forms"]["sed_to"]["orth"], "kingal")
        self.assertEqual(self.words["six"]["forms"]["pan"]["orth"], "*enem")
        self.assertEqual(self.words["nine"]["forms"]["pmp"]["orth"], "*siwa")

    def test_proto_provenance_and_fallback(self):
        selected = json.loads((ROOT / "source/import/acd_forms.json").read_text())
        fallback = set()
        for source in self.sources:
            if source["source_type"] != "acd":
                continue
            level = source["source_level"]
            self.assertTrue(source["source_id"].startswith("19072-" if level == "pan" else "19081-"))
            self.assertIn(source["source_id"], selected[source["concept_id"]][level])
            if source["fallback_from"]:
                concept = source["concept_id"]
                fallback.add(concept)
                self.assertFalse(selected[concept]["pmp"])
                self.assertEqual(source["variety_id"], "pmp")
                self.assertEqual(self.words[concept]["forms"]["pmp"]["orth"],
                                 self.words[concept]["forms"]["pan"]["orth"])
                self.assertIn("複製 PAn", self.words[concept]["forms"]["pmp"]["note"])
        self.assertEqual(fallback, {"cloud", "sing", "snow", "twenty"})

    def test_missing_inventory_and_semantic_distinctions(self):
        with (ROOT / "source/missing.csv").open(encoding="utf-8", newline="") as f:
            missing = {(r["concept_id"], r["variety_id"]) for r in csv.DictReader(f)}
        present = {(c, v) for c, w in self.words.items() for v in w["forms"]}
        expected = {(c["id"], v["id"]) for c in self.concepts["items"] for v in self.varieties}
        self.assertFalse(missing & present)
        self.assertEqual(missing | present, expected)
        for row in self.sources:
            if row["concept_id"] == "live":
                self.assertNotIn(row["source_gloss"], {"居住", "(居)住"})
            if row["concept_id"] == "bark":
                self.assertNotIn("dog", row["source_gloss"])
        counts = Counter(v for _, v in present)
        summary = json.loads((ROOT / "source/import_summary.json").read_text())
        self.assertEqual(dict(counts), summary["coverage"])
        self.assertEqual(len(present), summary["forms"])
