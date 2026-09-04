import copy
import csv
import json
import math
import shutil
import tempfile
import unittest
from pathlib import Path
from scripts.build import ROOT, DataError, build, validate, write_json


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name) / "input"
        shutil.copytree(ROOT / "tests/fixtures", self.source)
        self.output = Path(self.temp.name) / "output"

    def rows(self):
        with (self.source / "swadesh.csv").open(encoding="utf-8", newline="") as stream:
            return list(csv.reader(stream))

    def set_rows(self, rows, encoding="utf-8"):
        with (self.source / "swadesh.csv").open("w", encoding=encoding, newline="") as stream:
            csv.writer(stream).writerows(rows)

    def test_production_catalog_and_empty_forms(self):
        concepts, varieties, groups, words = validate(ROOT / "source")
        self.assertEqual(len(concepts["items"]), 207)
        self.assertEqual([i["swadesh_number"] for i in concepts["items"]], list(range(1, 208)))
        checks = {2: ("you_singular", "you (singular)"), 5: ("you_plural", "you (plural)"),
                  37: ("man", "man (adult male)"), 38: ("person", "man (human being)"),
                  74: ("eye", "eye"), 150: ("water", "water"),
                  196: ("correct", "correct"), 199: ("right", "right"), 207: ("name", "name")}
        for number, expected in checks.items():
            item = concepts["items"][number - 1]
            self.assertEqual((item["id"], item["gloss_en"]), expected)
        empty = Path(self.temp.name) / "empty-editorial"
        shutil.copytree(ROOT / "templates", empty)
        write_json(empty / "concepts.json", concepts)
        build(empty, self.output)
        self.assertEqual(len(list((self.output / "data/words").glob("*.json"))), 207)
        self.assertNotIn("合成測試資料", (self.output / "index.html").read_text())
        self.assertFalse((self.output / "tests").exists())

    def test_empty_templates_are_valid(self):
        concepts, varieties, groups, words = validate(ROOT / "templates")
        self.assertEqual(concepts["items"], [])
        self.assertEqual(words, {})
        self.assertEqual(varieties, [])
        self.assertEqual(groups, [])

    def test_unicode_bom_csv_quotes_and_newlines_survive(self):
        rows = self.rows()
        rows[1][2] = "*a\u0301, 'orth'"
        rows[1][3] = "*t͡sə\u0303ː"
        rows[1][4] = 'line one, "quoted"\nline two'
        self.set_rows(rows, encoding="utf-8-sig")
        build(self.source, self.output)
        form = json.loads((self.output / "data/words/water.json").read_text())["forms"][rows[1][1]]
        self.assertEqual([form[k] for k in ("orth", "ipa", "note")], rows[1][2:])

    def test_duplicate_pair_and_missing_required_forms(self):
        original = self.rows()
        scenarios = [(original + [original[1]], "重複組合")]
        for column, expected in ((2, "orth"), (3, "ipa")):
            rows = copy.deepcopy(original)
            rows[1][column] = " \t"
            scenarios.append((rows, expected))
        for rows, expected in scenarios:
            with self.subTest(expected=expected):
                self.set_rows(rows)
                with self.assertRaisesRegex(DataError, "swadesh.csv.*" + expected):
                    validate(self.source)

    def test_unknown_word_and_variety_references(self):
        original = self.rows()
        for column, expected in ((0, "concept_id"), (1, "variety_id")):
            rows = copy.deepcopy(original)
            rows[1][column] = "unknown"
            self.set_rows(rows)
            with self.assertRaisesRegex(DataError, "swadesh.csv.*" + expected):
                validate(self.source)

    def test_malformed_csv_reports_source_and_line(self):
        original = self.rows()
        for changed in [original[1][:-1], original[1] + ["extra"]]:
            rows = copy.deepcopy(original)
            rows[1] = changed
            self.set_rows(rows)
            with self.assertRaisesRegex(DataError, r"swadesh.csv:\d+"):
                validate(self.source)
        (self.source / "swadesh.csv").write_text(",".join(original[0]) + '\nwater,"unclosed', encoding="utf-8")
        with self.assertRaisesRegex(DataError, "swadesh.csv"):
            validate(self.source)

    def test_invalid_coordinates(self):
        original = json.loads((self.source / "varieties.json").read_text())
        for value in (None, True, "24.5", 91, -91, float("inf"), float("nan")):
            with self.subTest(value=value):
                data = copy.deepcopy(original)
                data[0]["latitude"] = value
                (self.source / "varieties.json").write_text(json.dumps(data), encoding="utf-8")
                with self.assertRaisesRegex(DataError, "varieties.json.*latitude"):
                    validate(self.source)

    def test_unknown_group_cycle_and_multiple_roots(self):
        original = json.loads((self.source / "subgroups.json").read_text())
        for parent, expected in (("missing", "未知 parent"), ("test_branch", "分類循環")):
            data = copy.deepcopy(original)
            data[0]["parent_id"] = parent
            write_json(self.source / "subgroups.json", data)
            with self.assertRaisesRegex(DataError, expected):
                validate(self.source)
        data = copy.deepcopy(original)
        data[-1]["parent_id"] = None
        write_json(self.source / "subgroups.json", data)
        with self.assertRaisesRegex(DataError, "一個根節點"):
            validate(self.source)

    def test_proto_relationship_type_and_back_reference(self):
        original = json.loads((self.source / "subgroups.json").read_text())
        for target in ("missing", "test_language", "test_proto_branch"):
            data = copy.deepcopy(original)
            data[0]["proto_variety_id"] = target
            write_json(self.source / "subgroups.json", data)
            with self.assertRaisesRegex(DataError, "proto_variety_id"):
                validate(self.source)

    def test_duplicate_ids_numbers_and_path_traversal(self):
        path = self.source / "concepts.json"
        original = json.loads(path.read_text())
        for field, value in [("id", original["items"][1]["id"]), ("id", "../outside"),
                             ("swadesh_number", original["items"][1]["swadesh_number"])]:
            data = copy.deepcopy(original)
            data["items"][0][field] = value
            write_json(path, data)
            with self.assertRaises(DataError):
                validate(self.source)

    def test_metadata_shape_errors(self):
        path = self.source / "varieties.json"
        original = json.loads(path.read_text())
        for field, value in (("type", "historical"), ("subgroup_id", "missing"), ("native_name", 5),
                             ("name", " "), ("longitude", 181), ("location_note", {})):
            data = copy.deepcopy(original)
            data[2][field] = value
            write_json(path, data)
            with self.assertRaisesRegex(DataError, "varieties.json"):
                validate(self.source)

    def test_validation_failure_preserves_previous_output(self):
        build(self.source, self.output)
        expected = (self.output / "data/words/water.json").read_bytes()
        self.set_rows(self.rows() + [self.rows()[1]])
        with self.assertRaises(DataError):
            build(self.source, self.output)
        self.assertEqual((self.output / "data/words/water.json").read_bytes(), expected)

    def test_rebuild_removes_stale_outputs_and_is_deterministic(self):
        build(self.source, self.output)
        first = (self.output / "data/words/water.json").read_bytes()
        stale = self.output / "data/words/stale.json"
        stale.write_text("{}")
        build(self.source, self.output)
        self.assertFalse(stale.exists())
        self.assertEqual((self.output / "data/words/water.json").read_bytes(), first)
        self.assertIn("合成測試資料", (self.output / "index.html").read_text())

    def test_refuse_unowned_output_and_source_overlap(self):
        self.output.mkdir()
        important = self.output / "important.txt"
        important.write_text("keep")
        with self.assertRaises(DataError):
            build(self.source, self.output)
        self.assertEqual(important.read_text(), "keep")
        for target in (self.source, self.source / "nested", ROOT, ROOT / "site"):
            with self.assertRaises(DataError):
                build(self.source, target)

    def test_debug_corpus_is_valid_and_separate_from_swadesh(self):
        demo = json.loads((ROOT / "site/assets/debug/999.json").read_text())
        self.assertEqual(demo["concept"]["swadesh_number"], 999)
        write_json(self.source / "concepts.json", {"source": {}, "items": [demo["concept"]]})
        write_json(self.source / "varieties.json", demo["varieties"])
        write_json(self.source / "subgroups.json", demo["subgroups"])
        self.set_rows([["concept_id", "variety_id", "orth", "ipa", "note"]] + [
            [demo["concept"]["id"], vid, form["orth"], form["ipa"], form["note"]]
            for vid, form in demo["forms"].items()
        ])
        _, varieties, _, words = validate(self.source)
        self.assertEqual(set(words[demo["concept"]["id"]]["forms"]), {v["id"] for v in varieties})
        self.assertTrue(any(v["type"] == "proto" for v in varieties))
        production = json.loads((ROOT / "source/concepts.json").read_text())
        self.assertNotIn(demo["concept"]["id"], {c["id"] for c in production["items"]})

    def test_geography_excludes_kinmen_and_has_major_rivers(self):
        land = json.loads((ROOT / "site/assets/taiwan.geojson").read_text())
        for polygon in land["features"][0]["geometry"]["coordinates"]:
            self.assertFalse(any(118 <= lng <= 118.6 and 24.2 <= lat <= 24.7 for lng, lat in polygon[0]))
        rivers = json.loads((ROOT / "site/assets/taiwan-rivers.geojson").read_text())
        self.assertEqual({f["properties"]["order"] for f in rivers["features"]}, {1})
        self.assertLess((ROOT / "site/assets/taiwan-rivers.geojson").stat().st_size, 350_000)
        def positions(coords):
            if isinstance(coords[0], (int, float)):
                yield coords
            else:
                for part in coords:
                    yield from positions(part)
        points = []
        for feature in rivers["features"]:
            self.assertIn(feature["geometry"]["type"], ("LineString", "MultiLineString"))
            for lng, lat in positions(feature["geometry"]["coordinates"]):
                self.assertTrue(119 < lng < 123 and 21 < lat < 26)
                points.append((lng, lat))
        # Spatial coverage across northern, western, southern and eastern Taiwan.
        # Check river corridors rather than names: HydroRIVERS does not supply names.
        for west, south, east, north in [
                (121.4, 24.9, 121.6, 25.2), (120.5, 23.7, 120.9, 23.9),
                (120.4, 22.6, 120.7, 23), (121.2, 23.3, 121.5, 23.6),
                (121.5, 24.5, 121.85, 24.8), (121, 22.7, 121.25, 23)]:
            self.assertTrue(any(west <= lng <= east and south <= lat <= north for lng, lat in points))
        self.assertLess(len(points), 20_000)

    def test_river_main_stems_have_no_short_fragments(self):
        rivers = json.loads((ROOT / "site/assets/taiwan-rivers.geojson").read_text())
        def km(a, b):
            lng1, lat1, lng2, lat2 = map(math.radians, (*a, *b))
            hav = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
            return 12742 * math.asin(min(1, math.sqrt(hav)))
        for feature in rivers["features"]:
            lines = feature["geometry"]["coordinates"]
            if feature["geometry"]["type"] == "LineString":
                lines = [lines]
            for line in lines:
                length = sum(km(a, b) for a, b in zip(line, line[1:]))
                # Independent geometric check with small rounding/geodesic tolerance.
                self.assertGreaterEqual(length, 39.8)

    def test_geography_contains_main_island_penghu_green_and_orchid(self):
        data = json.loads((ROOT / "site/assets/taiwan.geojson").read_text())
        polygons = data["features"][0]["geometry"]["coordinates"]
        for lng, lat in [(120.8, 24), (119.6, 23.56), (121.48, 22.66), (121.55, 22.04)]:
            self.assertTrue(any(min(p[0] for p in poly[0]) <= lng <= max(p[0] for p in poly[0])
                                and min(p[1] for p in poly[0]) <= lat <= max(p[1] for p in poly[0])
                                for poly in polygons))


if __name__ == "__main__":
    unittest.main()
