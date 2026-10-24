import unittest
from paramyth.contracts import ContractError, delta, plan, request, review


def example():
    return request({"project_id": "harbor", "premise": "Repair a harbor bell.",
                    "characters": [{"id": "mara"}, {"id": "oren"}]})


class ContractTests(unittest.TestCase):
    def test_request_defaults(self):
        value = example()
        self.assertEqual(value["chapters"], 3)
        self.assertEqual(value["runner_repo"], "paramyth-inference-runner")

    def test_request_rejects_unsafe_ids(self):
        with self.assertRaises(ContractError):
            request({"project_id": "../escape", "premise": "Test", "characters": [{"id": "mara"}]})

    def test_request_rejects_duplicate_characters(self):
        with self.assertRaises(ContractError):
            request({"project_id": "test", "premise": "Test", "characters": [{"id": "mara"}, {"id": "mara"}]})

    def test_request_rejects_unknown_knowledge_holders(self):
        with self.assertRaises(ContractError):
            request({"project_id": "test", "premise": "Test", "characters": [{"id": "mara"}],
                     "initial_facts": [{"text": "A secret", "known_by": ["unknown"]}]})

    def test_review_cannot_pass_with_blocking_issue(self):
        with self.assertRaises(ContractError):
            review({"pass": True, "issues": [{"severity": "blocking", "category": "continuity",
                    "quote": "The gate opened.", "problem": "It was locked.", "fix": "Explain access."}]},
                   "The gate opened.")

    def test_memory_requires_evidence_in_current_prose(self):
        with self.assertRaises(ContractError):
            delta({"memories": [{"kind": "event", "text": "An event",
                   "evidence": "This quote was never written.", "known_by": ["mara"]}]},
                  "Mara checked the tower latch.", ["mara"])

    def test_plan_rejects_missing_scenes(self):
        with self.assertRaises(ContractError):
            plan({"scenes": [], "threads": []}, example())


if __name__ == "__main__":
    unittest.main()
