import json
import unittest
from paramyth.contracts import delta, plan, request, review
from paramyth.fixture import respond


class FixtureTests(unittest.TestCase):
    def setUp(self):
        self.req = request({"project_id": "harbor", "premise": "Repair a harbor bell.",
                            "characters": [{"id": "mara"}, {"id": "oren"}]})

    def test_fixture_plan_satisfies_scene_contract(self):
        value = plan(json.loads(respond("architect", {}, self.req)), self.req)
        self.assertEqual(len(value["scenes"]), 9)
        self.assertEqual(value["scenes"][-1]["id"], "ch03-sc03")

    def test_fixture_memory_quotes_fixture_prose(self):
        prose = respond("writer", {"scene": {"id": "ch01-sc01"}}, self.req)
        memory = json.loads(respond("memory", {}, self.req))
        checked = delta(memory, prose, ["mara", "oren"])
        self.assertEqual(checked["memories"][0]["known_by"], ["mara"])
        self.assertIn("FIXTURE", prose)

    def test_fixture_review_satisfies_review_contract(self):
        prose = respond("writer", {}, self.req)
        value = review(json.loads(respond("story_quality", {}, self.req)), prose)
        self.assertTrue(value["pass"])

    def test_fixture_responses_are_deterministic(self):
        self.assertEqual(respond("architect", {}, self.req), respond("architect", {}, self.req))


if __name__ == "__main__":
    unittest.main()
