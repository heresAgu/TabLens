import json
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from recognition_lab import redact
from session_control import ControlError, claim_request, run_request, validate_request


class SessionControlTests(unittest.TestCase):
    def setUp(self):
        self.request = {"id": "a" * 32, "mode": "rhythm_prompt_compare", "rounds": 1}

    def fake_lab(self, state="complete", count=4):
        lab = SimpleNamespace(prepare_samples=Mock(return_value={}),
                              experiment_cases=Mock(return_value=[None] * count), redact=redact)
        def run(secret, emit, cancelled, mode):
            emit("log", "credential echo: " + secret)
            emit("done", {"state": state, "completed_requests": 4, "report": "local-mock-report.html"})
        lab.run_experiment = Mock(side_effect=run)
        return lab

    def test_request_rejects_credentials_paths_boolean_rounds_and_large_batches(self):
        for change in [{"secret": "unused-test-value"}, {"id": "../escape"},
                       {"mode": "../legacy"}, {"rounds": True}, {"rounds": 3}]:
            with self.subTest(change=change), self.assertRaises(ControlError):
                validate_request({**self.request, **change})

    def test_claimed_request_cannot_execute_twice_or_replay_after_restart(self):
        with tempfile.TemporaryDirectory(prefix="tablab-control-") as temporary:
            path = claim_request(self.request, temporary)
            self.assertTrue(path.is_file())
            self.assertIsNone(claim_request(self.request, temporary))
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["state"], "claimed")

    def test_no_credential_stops_before_loading_or_sending_requests(self):
        loader = Mock()
        with self.assertRaises(ControlError):
            run_request("", self.request, Mock(), threading.Event(), loader=loader)
        loader.assert_not_called()

    def test_bounded_task_redacts_credential_echo_and_returns_task_settings_only(self):
        lab = self.fake_lab()
        events = []
        secret = "unused-test-credential"
        result = run_request(secret, self.request, lambda k, d: events.append((k, d)),
                             threading.Event(), loader=lambda: lab)
        self.assertEqual(result["state"], "complete")
        self.assertEqual(result["maximum_api_calls"], 4)
        self.assertEqual(lab.run_experiment.call_count, 1)
        self.assertNotIn(secret, json.dumps([result, events]))

    def test_transport_or_format_failure_stops_second_round(self):
        lab = self.fake_lab(state="needs_attention")
        result = run_request("unused-test-credential", {**self.request, "rounds": 2},
                             Mock(), threading.Event(), loader=lambda: lab)
        self.assertEqual(lab.run_experiment.call_count, 1)
        self.assertEqual(result["state"], "needs_attention")

    def test_oversized_plan_and_cancelled_task_make_no_api_calls(self):
        lab = self.fake_lab(count=5)
        with self.assertRaises(ControlError):
            run_request("unused-test-credential", self.request, Mock(), threading.Event(), loader=lambda: lab)
        lab.run_experiment.assert_not_called()
        lab = self.fake_lab()
        cancelled = threading.Event()
        cancelled.set()
        result = run_request("unused-test-credential", self.request, Mock(), cancelled, loader=lambda: lab)
        lab.run_experiment.assert_not_called()
        self.assertEqual(result["state"], "cancelled")


if __name__ == "__main__":
    unittest.main()
