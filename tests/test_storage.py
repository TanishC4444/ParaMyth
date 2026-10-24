import json
from pathlib import Path
import tempfile
import unittest
from paramyth.storage import load, lock, save


class StorageTests(unittest.TestCase):
    def test_atomic_json_round_trip(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "nested" / "state.json"
            expected = {"version": 1, "text": "Mara’s lamp"}
            save(path, expected)
            self.assertEqual(load(path), expected)
            self.assertEqual(list(path.parent.glob(".writing-*")), [])

    def test_failed_serialization_preserves_state(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "state.json"
            save(path, {"version": 1})
            with self.assertRaises(TypeError):
                save(path, {"invalid": object()})
            self.assertEqual(load(path), {"version": 1})

    def test_lock_excludes_another_writer(self):
        with tempfile.TemporaryDirectory() as folder:
            with lock(folder):
                with self.assertRaises(RuntimeError):
                    with lock(folder):
                        pass
            self.assertFalse((Path(folder) / ".lock").exists())

    def test_exception_releases_lock(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError):
                with lock(folder):
                    raise ValueError("test")
            with lock(folder):
                self.assertTrue((Path(folder) / ".lock").exists())


if __name__ == "__main__":
    unittest.main()
