import copy
import csv
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from scripts.build import ROOT, validate
from scripts.learning import assemble, FIELDS, LearningError


class LearningDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        concepts, varieties, _, _ = validate(ROOT / "source")
        cls.index, cls.words, cls.reports = assemble(ROOT / "source", concepts, varieties)

    def test_complete_original_list_and_number_order(self):
        summary = self.reports["summary"]
        self.assertEqual((summary["entries"], summary["modern_varieties"], summary["original_rows"]), (1094, 42, 45948))
        self.assertEqual(summary["original_missing"], 188)
        ids = [i["entry_id"] for i in self.index["items"]]
        self.assertEqual(ids, sorted(ids, key=lambda x: tuple(map(int, x.split("-")))))
        self.assertLess(ids.index("26-99"), ids.index("26-100"))
        with (ROOT / "source/learning.csv").open(newline="") as stream:
            for r in csv.DictReader(stream):
                form = self.words[r["entry_id"]]["forms"].get(r["variety_id"])
                if r["orth"] == "無此詞彙":
                    if (r["entry_id"], r["variety_id"]) in {("04-07", "tha"), ("36-28", "yam")}:
                        self.assertTrue(form["sources"][0]["relation"] in {"equivalent", "narrower"})
                    else:
                        self.assertIsNone(form)
                else:
                    self.assertEqual(form["orth"], r["orth"])
                    self.assertEqual(form["source_gloss"], r["gloss_zh"])
                    self.assertEqual(form["sources"][0]["row"], r["row"])

    def test_semantics_pronouns_homonyms_and_reviewed_new_sources(self):
        items = {i["id"]: i for i in self.index["items"]}
        self.assertEqual(items["21-02"]["concept_ids"], ["water"])
        self.assertNotIn("you_plural", items["02-07"]["concept_ids"])
        self.assertGreater(len(items["01-38"]["aliases"]), 1)
        for lang in ["pan", "pmp"]:
            self.assertNotIn("incl.", self.words["02-13"]["forms"][lang]["source_gloss"])
            self.assertNotIn("excl.", self.words["02-14"]["forms"][lang]["source_gloss"])
            self.assertEqual(self.words["06-02"]["forms"][lang]["source_gloss"], "thigh")
            self.assertIn("bamboo", self.words["08-14"]["forms"][lang]["source_gloss"])
            self.assertNotIn("weevil", self.words["08-14"]["forms"][lang]["source_gloss"])
            self.assertNotIn(lang, self.words["08-12"]["forms"])  # maize ≠ a corn on skin
            self.assertNotIn(lang, self.words["32-67"]["forms"])  # well ≠ a water well
        self.assertEqual(self.words["07-02"]["forms"]["pan"]["source_gloss"], "pig")
        self.assertEqual(self.words["04-07"]["forms"]["tha"]["orth"], "ayuzi")
        self.assertIn("不代表妻子", self.words["04-07"]["forms"]["tha"]["note"])
        self.assertEqual(self.words["36-28"]["forms"]["yam"]["orth"], "mamimin")
        self.assertIn("pan", self.words["16-01"]["forms"])
        self.assertNotIn("pmp", self.words["16-01"]["forms"])
        for w in self.words.values():
            for lang in ("pan", "pmp"):
                if lang in w["forms"]:
                    self.assertTrue(w["forms"][lang]["orth"].startswith("*"))
                    self.assertTrue(all(r["source_id"] for r in w["forms"][lang]["sources"]))
                    prefix = "19072-" if lang == "pan" else "19081-"
                    self.assertTrue(all(r["source_id"].startswith(prefix) and not r["fallback_from"]
                                        for r in w["forms"][lang]["sources"]))


class LearningValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        (self.path / "import").mkdir()
        self.concepts = {"items": [{"id": "water"}]}
        self.varieties = [{"id": v, "type": "proto" if v in ("pan", "pmp") else "dialect"}
                          for v in ("a", "b", "pan", "pmp")]
        self.rows = [dict(zip(FIELDS, values)) for values in [
            ["b", "26-100", "其他原義", "word-b", "原註", "初級", "b.xlsx", "B", "5", ""],
            ["a", "26-100", "水", "無此詞彙", "", "初級", "a.xlsx", "A", "5", ""],
            ["a", "26-99", "水", "word-a", "", "初級", "a.xlsx", "A", "6", "water"],
            ["b", "26-99", "水", "word-b2", "", "初級", "b.xlsx", "B", "6", "water"],
        ]]
        e = dict(gloss_zh="水", gloss_en="water", concepts=[dict(concept_id="water", relation="equivalent", note="同義")],
                 proto={"pan": [], "pmp": []}, supplements=[])
        self.mapping = dict(expected_entries=2, expected_rows=4, entries={"26-99": copy.deepcopy(e), "26-100": copy.deepcopy(e)})
        self.mapping["entries"]["26-100"]["supplements"] = [dict(variety_id="a", entry_id="26-99", relation="equivalent", note="同語言原義相同")]
        self.mapping["entries"]["26-99"]["proto"]["pan"] = [dict(form_id="fid", relation="narrower", note="來源特指淡水")]
        self.archive = {"records": [dict(ID="fid", Language_ID="19072", Value="*test", Description="fresh water")]}

    def save(self):
        with (self.path / "learning.csv").open("w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=FIELDS)
            w.writeheader()
            w.writerows(self.rows)
        self.mapping["source_sha256"] = hashlib.sha256((self.path / "learning.csv").read_bytes()).hexdigest()
        (self.path / "import/learning_matches.json").write_text(json.dumps(self.mapping))
        (self.path / "import/learning_acd_records.json").write_text(json.dumps(self.archive))

    def run_assemble(self):
        self.save()
        return assemble(self.path, self.concepts, self.varieties)

    def test_tie_breaker_same_variety_supplement_and_no_proto_fallback(self):
        index, words, reports = self.run_assemble()
        self.assertEqual([i["id"] for i in index["items"]], ["26-99", "26-100"])
        self.assertEqual(index["items"][1]["gloss_zh"], "水")  # variety order, not CSV row order
        self.assertEqual(words["26-100"]["forms"]["a"]["orth"], "word-a")
        self.assertEqual(words["26-100"]["forms"]["b"]["source_gloss"], "其他原義")
        self.assertIn("pan", words["26-99"]["forms"])
        self.assertNotIn("pmp", words["26-99"]["forms"])
        self.assertTrue(any(r["entry_id"] == "26-99" and r["variety_id"] == "pmp" for r in reports["missing"]))
        self.assertEqual(reports["summary"]["modern_supplements"], 1)
        self.assertEqual(reports["summary"]["pan_fallbacks"], 0)

    def test_duplicates_missing_varieties_and_unknown_concepts(self):
        baseline = copy.deepcopy(self.rows)
        for rows, expected in [(baseline + [baseline[0]], "重複"), (baseline[:-1], "列數")]:
            with self.subTest(expected=expected):
                self.rows = rows
                with self.assertRaisesRegex(LearningError, expected): self.run_assemble()
        self.rows = baseline
        self.mapping["entries"]["26-99"]["concepts"][0]["concept_id"] = "missing"
        with self.assertRaisesRegex(LearningError, "未知或重複概念"): self.run_assemble()

    def test_missing_source_wrong_proto_level_and_unreviewed_changes(self):
        record = self.archive["records"][0]
        record["Language_ID"] = "19081"
        with self.assertRaisesRegex(LearningError, "語言層級不符"): self.run_assemble()
        record["Language_ID"] = "19072"
        self.mapping["entries"]["26-99"]["proto"]["pan"][0]["form_id"] = "missing"
        with self.assertRaisesRegex(LearningError, "未知或重複 ACD"): self.run_assemble()
        self.save()
        with (self.path / "learning.csv").open("a") as f: f.write("\n")
        with self.assertRaisesRegex(LearningError, "已變更"):
            assemble(self.path, self.concepts, self.varieties)

    def test_supplement_cannot_overwrite_or_use_missing_source(self):
        supplement = self.mapping["entries"]["26-100"]["supplements"][0]
        supplement["variety_id"] = "b"
        with self.assertRaisesRegex(LearningError, "不得覆寫"): self.run_assemble()
        supplement["variety_id"] = "a"
        supplement["entry_id"] = "26-100"
        with self.assertRaisesRegex(LearningError, "來源缺漏"): self.run_assemble()

    def test_empty_dataset_omits_learning(self):
        index, words, _ = assemble(self.path, self.concepts, self.varieties)
        self.assertEqual(index["items"], [])
        self.assertEqual(words, {})
