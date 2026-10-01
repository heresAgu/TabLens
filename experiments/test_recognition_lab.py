import copy
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import MagicMock, patch

import recognition_lab
from recognition_lab import REFERENCE_PATH, SYSTEM_PROMPT, USER_PROMPT, evaluate, redact


class EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.reference = json.loads(REFERENCE_PATH.read_text(encoding="utf-8"))

    def test_equivalent_fractions_and_chord_order_are_accepted(self):
        prediction = copy.deepcopy(self.reference)
        prediction["measures"][0]["events"][0]["notes"].reverse()
        prediction["measures"][0]["events"][0]["duration"] = "2/16"
        comparison = evaluate(prediction, self.reference)
        self.assertEqual(comparison["exact_events"], 16)
        self.assertEqual(comparison["exact_measures"], 2)
        self.assertFalse(comparison["issues"])

    def test_split_chord_is_not_counted_as_correct(self):
        prediction = copy.deepcopy(self.reference)
        event = prediction["measures"][0]["events"][0]
        second = copy.deepcopy(event)
        second["notes"] = [event["notes"].pop()]
        prediction["measures"][0]["events"].insert(1, second)
        comparison = evaluate(prediction, self.reference)
        self.assertLess(comparison["exact_events"], 16)
        self.assertLess(comparison["exact_measures"], 2)
        self.assertEqual(comparison["actual_events"], 17)

    def test_unknown_duration_is_not_a_success(self):
        prediction = copy.deepcopy(self.reference)
        prediction["measures"][0]["events"][0]["duration"] = None
        comparison = evaluate(prediction, self.reference)
        self.assertEqual(comparison["note_groups_correct"], 16)
        self.assertEqual(comparison["rhythm_correct"], 15)
        self.assertEqual(comparison["exact_events"], 15)

    def test_wrong_capo_and_boolean_metadata_are_rejected(self):
        prediction = copy.deepcopy(self.reference)
        prediction["metadata"]["capo"] = 0
        prediction["metadata"]["tempo_bpm"] = True
        comparison = evaluate(prediction, self.reference)
        fields = {item["field"]: item for item in comparison["metadata"]}
        self.assertFalse(fields["capo"]["correct"])
        self.assertFalse(fields["tempo_bpm"]["correct"])

    def test_time_signature_string_is_semantically_equivalent(self):
        prediction = copy.deepcopy(self.reference)
        prediction["metadata"]["time_signature"] = "4/4"
        comparison = evaluate(prediction, self.reference)
        fields = {item["field"]: item for item in comparison["metadata"]}
        self.assertTrue(fields["time_signature"]["correct"])
        self.assertEqual(fields["time_signature"]["normalized"], [4, 4])

    def test_extra_half_bar_invalidates_measure_timeline(self):
        prediction = copy.deepcopy(self.reference)
        event = copy.deepcopy(prediction["measures"][0]["events"][-1])
        event["onset"] = "1"
        prediction["measures"][0]["events"].append(event)
        comparison = evaluate(prediction, self.reference)
        self.assertEqual(comparison["rhythm_correct"], 16)
        self.assertEqual(comparison["valid_measure_timelines"], 1)
        self.assertEqual(comparison["exact_measures"], 1)

    def test_invalid_timing_is_reported_instead_of_crashing(self):
        prediction = copy.deepcopy(self.reference)
        prediction["measures"][0]["events"][0]["duration"] = "1/0"
        comparison = evaluate(prediction, self.reference)
        self.assertEqual(comparison["exact_events"], 15)
        self.assertTrue(comparison["issues"])

    def test_missing_notes_do_not_suppress_correct_rhythm_or_break_its_timeline(self):
        prediction = copy.deepcopy(self.reference)
        prediction["measures"][0]["events"][5]["notes"] = []
        comparison = evaluate(prediction, self.reference)
        self.assertEqual(comparison["note_groups_correct"], 15)
        self.assertEqual(comparison["rhythm_correct"], 16)
        self.assertEqual(comparison["valid_measure_timelines"], 2)
        self.assertEqual(comparison["exact_events"], 15)
        self.assertFalse(any("前序时值不衔接" in issue for issue in comparison["issues"]))

    def test_incorrect_rhythm_does_not_suppress_correct_notes(self):
        prediction = copy.deepcopy(self.reference)
        prediction["measures"][0]["events"][0]["duration"] = "1/0"
        comparison = evaluate(prediction, self.reference)
        self.assertEqual(comparison["note_groups_correct"], 16)
        self.assertEqual(comparison["rhythm_correct"], 15)
        self.assertEqual(comparison["exact_events"], 15)

    def test_missing_measure_and_extra_measure_are_flagged(self):
        prediction = copy.deepcopy(self.reference)
        prediction["measures"][1]["number"] = 4
        comparison = evaluate(prediction, self.reference)
        self.assertEqual(comparison["exact_events"], 8)
        self.assertTrue(any("缺少小节 3" in item for item in comparison["issues"]))
        self.assertTrue(any("范围以外" in item for item in comparison["issues"]))

    def test_secret_is_redacted_recursively(self):
        fake_secret = "test-credential-never-used"
        value = {"content": fake_secret, "nested": ["prefix " + fake_secret]}
        sanitized = redact(value, fake_secret)
        self.assertNotIn(fake_secret, json.dumps(sanitized))

    def test_api_prompts_do_not_contain_reference_note_sequence(self):
        combined = SYSTEM_PROMPT + USER_PROMPT
        self.assertNotIn('"string":2,"fret":0', combined)
        self.assertNotIn('"string":5,"fret":2', combined)

    def test_unexpected_technique_is_flagged(self):
        prediction = copy.deepcopy(self.reference)
        prediction["measures"][0]["events"][0]["techniques"] = ["bend"]
        comparison = evaluate(prediction, self.reference)
        self.assertEqual(comparison["exact_events"], 15)
        self.assertTrue(any("不存在的技巧" in item for item in comparison["issues"]))


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.reference = json.loads(REFERENCE_PATH.read_text(encoding="utf-8"))
        self.samples = {"whole_page": recognition_lab.SOURCE_IMAGE,
                        "header": recognition_lab.BASE_DIR / "samples" / "lullaby_header.png",
                        "row": recognition_lab.BASE_DIR / "samples" / "lullaby_measures_2_3.png"}

    def fake_response(self, status=200, content=None):
        response = MagicMock()
        response.status_code = status
        response.json.return_value = {
            "model": "mock-model-not-a-real-api-result",
            "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(self.reference) if content is None else content}}],
            "usage": {"prompt_tokens": 1200, "completion_tokens": 900}}
        return response

    def run_mocked(self, responses, secret="unused-test-credential", mode="legacy"):
        with tempfile.TemporaryDirectory(prefix="tablab-test-") as temporary:
            temporary_path = Path(temporary).resolve()
            self.assertTrue(temporary_path.name.startswith("tablab-test-"))
            posted = MagicMock()
            posted.post.side_effect = responses
            events = []
            with patch.object(recognition_lab, "BASE_DIR", temporary_path), \
                 patch.object(recognition_lab, "STATUS_PATH", temporary_path / "status.json"), \
                 patch.object(recognition_lab, "prepare_samples", return_value=self.samples), \
                 patch.object(recognition_lab.requests, "Session") as session:
                session.return_value.__enter__.return_value = posted
                recognition_lab.run_experiment(secret, lambda kind, value: events.append((kind, value)), threading.Event(), mode)
                self.last_payloads = [call.kwargs["json"] for call in posted.post.call_args_list]
            status = json.loads((temporary_path / "status.json").read_text(encoding="utf-8"))
            report = Path(status["report"]).read_text(encoding="utf-8")
            summary = json.loads((Path(status["run_directory"]) / "summary.json").read_text(encoding="utf-8"))
            all_saved_bytes = b"\n".join(path.read_bytes() for path in temporary_path.rglob("*") if path.is_file())
            self.assertNotIn(secret.encode("utf-8"), all_saved_bytes)
            return posted.post.call_count, status, summary, report, events

    def test_three_requests_generate_report_without_persisting_credential(self):
        count, status, summary, report, events = self.run_mocked([self.fake_response() for _ in range(3)])
        self.assertEqual(count, 3)
        self.assertEqual(status["status"], "complete")
        self.assertTrue(all(item["comparison"]["exact_events"] == 16 for item in summary["results"]))
        self.assertIn("mock", summary["results"][0]["returned_model"])
        self.assertIn("参考答案没有发送给模型", report)
        self.assertEqual(events[-1][0], "done")
        self.assertTrue(all(payload["thinking"]["type"] == "disabled" for payload in self.last_payloads))
        self.assertTrue(all("reasoning_effort" not in payload for payload in self.last_payloads))

    def test_auth_failure_stops_without_retrying(self):
        count, status, summary, _, _ = self.run_mocked([self.fake_response(status=401)])
        self.assertEqual(count, 1)
        self.assertEqual(status["status"], "needs_attention")
        self.assertEqual(summary["results"][0]["http_status"], 401)

    def test_invalid_model_output_is_escaped_in_report(self):
        payload = "<script>not executable</script>"
        count, status, summary, report, _ = self.run_mocked([self.fake_response(content=payload) for _ in range(3)])
        self.assertEqual(count, 1)
        self.assertEqual(status["status"], "needs_attention")
        self.assertTrue(all(item["status"] == "invalid_json" for item in summary["results"]))
        self.assertNotIn(payload, report)
        self.assertIn("&lt;script&gt;", report)

    def test_empty_output_with_exhausted_budget_stops_after_one_request(self):
        response = self.fake_response(content="")
        response.json.return_value["choices"][0]["finish_reason"] = "length"
        count, status, summary, _, _ = self.run_mocked([response])
        self.assertEqual(count, 1)
        self.assertEqual(status["status"], "needs_attention")
        self.assertEqual(summary["results"][0]["status"], "output_truncated")

    def test_symbol_comparison_compiles_observations_using_identical_images(self):
        from test_symbol_reader import reference_symbols
        symbols = json.dumps(reference_symbols(), ensure_ascii=False)
        count, status, summary, report, _ = self.run_mocked(
            [self.fake_response(), self.fake_response(content=symbols), self.fake_response(content=symbols)],
            mode="symbols_compare")
        self.assertEqual(count, 3)
        self.assertEqual(status["status"], "complete")
        self.assertEqual([item["reading_method"] for item in summary["results"]], ["direct", "symbols", "symbols"])
        self.assertTrue(all(item["comparison"]["exact_events"] == 16 for item in summary["results"]))
        self.assertEqual(summary["results"][1]["reading_comparison"]["note_positions_matching"], 20)
        self.assertIn("程序换算后的乐谱", report)
        images = [payload["messages"][1]["content"][1:] for payload in self.last_payloads]
        self.assertEqual(images[0], images[1])
        self.assertEqual(images[1], images[2])
        self.assertNotEqual(self.last_payloads[0]["messages"][0], self.last_payloads[1]["messages"][0])
        self.assertTrue(all(payload["temperature"] == 0 for payload in self.last_payloads))

    def test_wrong_symbol_schema_is_saved_and_reported_without_guessing(self):
        from test_symbol_reader import reference_symbols
        count, status, summary, report, _ = self.run_mocked(
            [self.fake_response(), self.fake_response(), self.fake_response(content=json.dumps(reference_symbols()))],
            mode="symbols_compare")
        self.assertEqual(count, 3)
        self.assertEqual(status["status"], "needs_attention")
        self.assertEqual(summary["results"][1]["status"], "symbol_format_error")
        self.assertNotIn("comparison", summary["results"][1])
        self.assertIn("记号格式无法换算", report)

    def test_string_verification_uses_model_draft_without_reference_feedback(self):
        from test_string_verifier import reference_reading
        correct = reference_reading()
        draft = copy.deepcopy(correct)
        draft["measures"][0]["strings"][1]["frets"] = [9]
        responses = [self.fake_response(content=json.dumps(reading))
                     for reading in [draft, correct, correct, correct]]
        count, status, summary, report, _ = self.run_mocked(responses, mode="strings_verify")
        self.assertEqual(count, 4)
        self.assertEqual(status["planned_requests"], 4)
        self.assertEqual(status["status"], "complete")
        review = summary["results"][2]
        self.assertEqual(review["draft_source_case"], "01_strings_forward")
        self.assertEqual(review["verification_comparison"]["fixed_rows"], 1)
        self.assertEqual(review["verification_comparison"]["regressed_rows"], 0)
        review_text = self.last_payloads[2]["messages"][1]["content"][0]["text"]
        submitted = json.loads(review_text.split('<draft_json>\n', 1)[1].split('\n</draft_json>', 1)[0])
        self.assertEqual(submitted, draft)
        self.assertNotIn("ordered_note_matches", review_text)
        self.assertNotIn("expected", review_text)
        self.assertEqual(self.last_payloads[1], self.last_payloads[3])
        self.assertIn("误改原本正确", report)
        self.assertNotIn("comparison", review)

    def test_failed_string_reading_stops_before_paid_verification(self):
        count, status, summary, _, _ = self.run_mocked([self.fake_response()], mode="strings_verify")
        self.assertEqual(count, 1)
        self.assertEqual(status["status"], "needs_attention")
        self.assertEqual(summary["results"][0]["status"], "string_format_error")

    def test_credential_echo_is_redacted_before_draft_is_resubmitted(self):
        from test_string_verifier import reference_reading
        secret = "unused-test-credential-echo"
        reading = reference_reading()
        reading["uncertain_items"] = [secret]
        count, _, _, _, _ = self.run_mocked(
            [self.fake_response(content=json.dumps(reading)) for _ in range(4)],
            secret=secret, mode="strings_verify")
        self.assertEqual(count, 4)
        review_text = self.last_payloads[2]["messages"][1]["content"][0]["text"]
        self.assertNotIn(secret, review_text)
        self.assertIn("[REDACTED]", review_text)

    def test_anchor_experiment_compares_prompts_and_inputs_without_reference_answers(self):
        from test_string_verifier import reference_reading
        self.samples = recognition_lab.prepare_samples()
        reading = json.dumps(reference_reading())
        count, status, summary, report, _ = self.run_mocked(
            [self.fake_response(content=reading) for _ in range(4)], mode="strings_anchors")
        self.assertEqual(count, 4)
        self.assertEqual(status["status"], "complete")
        payloads = self.last_payloads
        content = [payload["messages"][1]["content"] for payload in payloads]
        self.assertEqual(content[0][1:], content[1][1:])
        self.assertNotEqual(content[0][0], content[1][0])
        self.assertEqual(content[1][0], content[2][0])
        self.assertNotEqual(content[1][2], content[2][2])
        self.assertNotEqual(content[2][2], content[3][2])
        self.assertTrue(all(result["string_diagnostic"]["correct_nonempty_rows"] == 9
                            for result in summary["results"]))
        self.assertTrue(all("verification_comparison" not in result for result in summary["results"]))
        for item in content:
            self.assertNotIn("<draft_json>", item[0]["text"])
            self.assertNotIn('"frets":[0', item[0]["text"])
            self.assertNotIn("ordered_note_matches", item[0]["text"])
        self.assertIn("本次实际输入图片", report)

    def test_event_pipeline_merges_each_pair_without_using_reference_to_repair_notes(self):
        from test_event_pipeline import reference_parts
        positions, rhythm, _ = reference_parts()
        wrong_positions = copy.deepcopy(positions)
        wrong_positions["measures"][0]["string_rows"][1]["notes"][0]["fret"] = 9
        self.samples = recognition_lab.prepare_samples()
        readings = [positions, rhythm, wrong_positions, rhythm]
        count, status, summary, report, _ = self.run_mocked(
            [self.fake_response(content=json.dumps(reading)) for reading in readings], mode="events_pipeline")
        self.assertEqual(count, 4)
        self.assertEqual(status["status"], "complete")
        results = summary["results"]
        self.assertNotIn("comparison", results[0])
        self.assertEqual(results[1]["comparison"]["exact_events"], 16)
        self.assertEqual(results[3]["comparison"]["exact_events"], 15)
        self.assertEqual(results[3]["grouping_diagnostic"]["correct_simultaneous_groups"], 3)
        self.assertEqual(results[3]["pipeline_pair"]["positions"], "03_positions_repeat")
        self.assertEqual(self.last_payloads[0], self.last_payloads[2])
        self.assertEqual(self.last_payloads[1], self.last_payloads[3])
        for payload in self.last_payloads:
            text = payload["messages"][1]["content"][0]["text"]
            self.assertNotIn("<draft_json>", text)
            self.assertNotIn("expected", text)
            self.assertNotIn('"fret": 0', text)
        self.assertIn("同时弹组合正确", report)
        self.assertIn("单音组合在对应先后位置正确", report)

    def test_bad_position_output_stops_before_rhythm_request(self):
        self.samples = recognition_lab.prepare_samples()
        count, status, summary, _, _ = self.run_mocked([self.fake_response()], mode="events_pipeline")
        self.assertEqual(count, 1)
        self.assertEqual(status["status"], "needs_attention")
        self.assertEqual(summary["results"][0]["status"], "symbol_format_error")

    def test_cell_pipeline_uses_grid_membership_and_preserves_source_regions(self):
        from test_cell_reader import reference_cells
        from test_event_pipeline import reference_parts
        cells = reference_cells()
        _, rhythm, _ = reference_parts()
        self.samples = recognition_lab.prepare_samples()
        readings = [cells, rhythm, cells, rhythm]
        count, status, summary, _, _ = self.run_mocked(
            [self.fake_response(content=json.dumps(reading)) for reading in readings], mode="cells_pipeline")
        self.assertEqual(count, 4)
        self.assertEqual(status["status"], "complete")
        results = summary["results"]
        self.assertNotIn("comparison", results[0])
        self.assertEqual(results[0]["reading_comparison"]["note_positions_matching"], 20)
        self.assertEqual(results[1]["comparison"]["exact_events"], 16)
        self.assertEqual(results[3]["comparison"]["exact_events"], 16)
        self.assertEqual(results[1]["grouping_diagnostic"]["correct_simultaneous_groups"], 4)
        self.assertTrue(results[1]["compiler"]["ready_for_playback"])
        notes = [note for m in results[1]["compiled_score"]["measures"] for e in m["events"] for note in e["notes"]]
        self.assertTrue(all(len(note["source"]["cell_source_box"]) == 4 for note in notes))
        self.assertEqual(results[3]["pipeline_pair"]["positions"], "03_cells_repeat")
        self.assertEqual(self.last_payloads[0], self.last_payloads[2])
        self.assertEqual(self.last_payloads[1], self.last_payloads[3])
        self.assertEqual(len(self.last_payloads[0]["messages"][1]["content"]), 4)

    def verified_readings(self, missing=True, fix=True):
        from test_cell_reader import reference_cells
        from test_event_pipeline import reference_parts
        from test_string_verifier import reference_reading
        from cell_verifier import cross_check
        cells = reference_cells()
        if missing:
            cells["measures"][0]["string_rows"][2]["cells"][-1] = []
        audit = reference_reading()
        _, rhythm, anchors = reference_parts()
        targets = cross_check(cells, audit, rhythm, anchors)["review_targets"]
        final_cells = reference_cells() if fix else cells
        final_rows = {(m["number"], r["string"]): r for m in final_cells["measures"] for r in m["string_rows"]}
        review = {"cells": [{"id": t["id"], "value": final_rows[t["measure"], t["string"]]["cells"][t["column"] - 1]}
                            for t in targets], "uncertain_items": []}
        return [cells, rhythm, audit, review]

    def test_independent_audit_and_local_review_preserve_initial_and_final_results(self):
        self.samples = recognition_lab.prepare_samples()
        count, status, summary, report, _ = self.run_mocked(
            [self.fake_response(content=json.dumps(r)) for r in self.verified_readings()], mode="cells_verified")
        self.assertEqual(count, 4)
        self.assertEqual(status["status"], "complete")
        baseline, _, audit, final = summary["results"]
        self.assertEqual(baseline["reading_comparison"]["assigned_notes"], 19)
        self.assertEqual(audit["comparison"]["exact_events"], 15)
        self.assertFalse(audit["compiler"]["ready_for_playback"])
        self.assertEqual(final["comparison"]["exact_events"], 16)
        self.assertTrue(final["compiler"]["ready_for_playback"])
        self.assertEqual(len(final["review_changes"]), 1)
        self.assertNotEqual(self.last_payloads[0]["messages"][1]["content"][1:],
                            self.last_payloads[2]["messages"][1]["content"][1:])
        for payload in self.last_payloads:
            text = payload["messages"][1]["content"][0]["text"]
            self.assertNotIn("<draft_json>", text)
            self.assertNotIn("audit_frets", text)
            self.assertNotIn("cell_frets", text)
        self.assertIn("两份独立读数一致", report)
        self.assertIn("局部核查产生的改动", report)

    def test_consistent_independent_readings_skip_fourth_paid_call(self):
        self.samples = recognition_lab.prepare_samples()
        count, status, summary, _, _ = self.run_mocked(
            [self.fake_response(content=json.dumps(r)) for r in self.verified_readings(missing=False)[:3]],
            mode="cells_verified")
        self.assertEqual(count, 3)
        self.assertEqual(status["completed_requests"], 3)
        self.assertTrue(summary["results"][-1]["cross_check"]["consistent"])
        self.assertTrue(summary["results"][-1]["compiler"]["ready_for_playback"])

    def test_failed_local_correction_retains_conflict_instead_of_using_auditor_as_answer(self):
        self.samples = recognition_lab.prepare_samples()
        count, _, summary, _, _ = self.run_mocked(
            [self.fake_response(content=json.dumps(r)) for r in self.verified_readings(fix=False)], mode="cells_verified")
        self.assertEqual(count, 4)
        final = summary["results"][-1]
        self.assertEqual(final["comparison"]["exact_events"], 15)
        self.assertEqual(final["review_changes"], [])
        self.assertFalse(final["compiler"]["ready_for_playback"])

    def test_incomplete_local_review_stops_and_leaves_previous_conflicts_visible(self):
        self.samples = recognition_lab.prepare_samples()
        readings = self.verified_readings()
        readings[-1]["cells"].pop()
        count, status, summary, _, _ = self.run_mocked(
            [self.fake_response(content=json.dumps(r)) for r in readings], mode="cells_verified")
        self.assertEqual(count, 4)
        self.assertEqual(status["status"], "needs_attention")
        self.assertEqual(summary["results"][-1]["status"], "symbol_format_error")
        self.assertNotIn("compiled_score", summary["results"][-1])

    def test_mixed_rhythm_runner_keeps_notes_out_of_timing_evaluation(self):
        from test_rhythm_diagnostic import reference_rhythm
        self.samples = recognition_lab.prepare_samples()
        readings = [reference_rhythm(n)[0] for n in [1, 1, 4, 4]]
        count, status, summary, report, _ = self.run_mocked(
            [self.fake_response(content=json.dumps(r)) for r in readings], mode="rhythm_diagnostic")
        self.assertEqual(count, 4)
        self.assertEqual(status["status"], "complete")
        for result in summary["results"]:
            self.assertEqual(result["rhythm_comparison"]["rhythm_correct"], 10)
            self.assertNotIn("compiled_score", result)
            self.assertNotIn("comparison", result)
        self.assertIn("混合节奏诊断", report)
        self.assertNotIn("固定 16 个音乐事件", report)
        for payload in self.last_payloads:
            text = payload["messages"][1]["content"][0]["text"]
            self.assertNotIn('"beam_count":3', text)
            self.assertNotIn("1/32", text)
            self.assertNotIn("第2、3小节", text)
        self.assertEqual(self.last_payloads[0]["messages"][0], self.last_payloads[1]["messages"][0])
        self.assertNotEqual(self.last_payloads[0]["messages"][1]["content"][2],
                            self.last_payloads[1]["messages"][1]["content"][2])

    def test_invalid_mixed_rhythm_response_stops_before_next_paid_call(self):
        self.samples = recognition_lab.prepare_samples()
        count, status, summary, _, _ = self.run_mocked([self.fake_response()], mode="rhythm_diagnostic")
        self.assertEqual(count, 1)
        self.assertEqual(status["status"], "needs_attention")
        self.assertEqual(summary["results"][0]["status"], "symbol_format_error")

    def test_rhythm_prompt_comparison_changes_only_system_instructions_within_each_pair(self):
        from test_rhythm_diagnostic import reference_rhythm
        self.samples = recognition_lab.prepare_samples()
        readings = [reference_rhythm(n)[0] for n in [1, 1, 4, 4]]
        count, status, summary, _, _ = self.run_mocked(
            [self.fake_response(content=json.dumps(r)) for r in readings], mode="rhythm_prompt_compare")
        self.assertEqual(count, 4)
        self.assertEqual(status["status"], "complete")
        self.assertTrue(all(r["rhythm_comparison"]["beam_counts_correct"] == 10 for r in summary["results"]))
        for first in [0, 2]:
            self.assertEqual(self.last_payloads[first]["messages"][1], self.last_payloads[first + 1]["messages"][1])
            self.assertNotEqual(self.last_payloads[first]["messages"][0], self.last_payloads[first + 1]["messages"][0])
            self.assertIn("共用主横梁", self.last_payloads[first + 1]["messages"][0]["content"])
            for field in ["model", "temperature", "thinking", "max_tokens", "response_format"]:
                self.assertEqual(self.last_payloads[first][field], self.last_payloads[first + 1][field])

    def test_group_comparison_changes_only_extra_image_and_keeps_timing_scope(self):
        from test_rhythm_diagnostic import reference_rhythm
        self.samples = recognition_lab.prepare_samples()
        readings = [reference_rhythm(n)[0] for n in [1, 1, 4, 4]]
        count, status, summary, report, _ = self.run_mocked(
            [self.fake_response(content=json.dumps(r)) for r in readings], mode="rhythm_groups_compare")
        self.assertEqual(count, 4)
        self.assertEqual(status["status"], "complete")
        for first in (0, 2):
            baseline, zoom = self.last_payloads[first:first + 2]
            self.assertEqual(baseline["messages"][0], zoom["messages"][0])
            a, b = baseline["messages"][1]["content"], zoom["messages"][1]["content"]
            self.assertEqual(len(a), 3)
            self.assertEqual(len(b), 4)
            self.assertEqual(a, b[:3])
            self.assertIn("如果有第三张图", a[0]["text"])
            self.assertNotIn("1/32", a[0]["text"])
            self.assertNotIn('"beam_count":3', a[0]["text"])
            for field in ("model", "temperature", "thinking", "max_tokens", "response_format"):
                self.assertEqual(baseline[field], zoom[field])
        for result in summary["results"]:
            self.assertEqual(result["rhythm_comparison"]["rhythm_correct"], 10)
            self.assertNotIn("compiled_score", result)
        self.assertIn("整组横梁放大", report)

    def test_invalid_group_comparison_output_stops_remaining_requests(self):
        self.samples = recognition_lab.prepare_samples()
        count, status, _, _, _ = self.run_mocked([self.fake_response()], mode="rhythm_groups_compare")
        self.assertEqual(count, 1)
        self.assertEqual(status["status"], "needs_attention")

    def test_contrast_comparison_changes_only_third_image_and_keeps_original_context(self):
        from test_rhythm_diagnostic import reference_rhythm
        self.samples = recognition_lab.prepare_samples()
        readings = [reference_rhythm(n)[0] for n in [1, 1, 4, 4]]
        count, status, summary, report, _ = self.run_mocked(
            [self.fake_response(content=json.dumps(r)) for r in readings], mode="rhythm_contrast_compare")
        self.assertEqual(count, 4)
        self.assertEqual(status["status"], "complete")
        for first in (0, 2):
            original, contrast = self.last_payloads[first:first + 2]
            self.assertEqual(original["messages"][0], contrast["messages"][0])
            a, b = original["messages"][1]["content"], contrast["messages"][1]["content"]
            self.assertEqual(len(a), 4)
            self.assertEqual(a[:3], b[:3])
            self.assertNotEqual(a[3], b[3])
            self.assertNotIn("1/32", a[0]["text"])
            self.assertNotIn('"beam_count":3', a[0]["text"])
            for field in ("model", "temperature", "thinking", "max_tokens", "response_format"):
                self.assertEqual(original[field], contrast[field])
        for result in summary["results"]:
            self.assertEqual(result["rhythm_comparison"]["rhythm_correct"], 10)
            self.assertNotIn("compiled_score", result)
        self.assertIn("灰度提亮", report)

    def test_invalid_contrast_response_stops_remaining_paid_calls(self):
        self.samples = recognition_lab.prepare_samples()
        count, status, _, _, _ = self.run_mocked([self.fake_response()], mode="rhythm_contrast_compare")
        self.assertEqual(count, 1)
        self.assertEqual(status["status"], "needs_attention")

    def beam_review_readings(self, corrected=True):
        from test_rhythm_diagnostic import reference_rhythm
        readings = []
        for number in (1, 4):
            correct = reference_rhythm(number)[0]
            initial = copy.deepcopy(correct)
            columns = initial["measures"][0]["columns"]
            if number == 1:
                for index, beams in ((7, 2), (8, 2), (9, 1)):
                    columns[index]["rhythm"]["beam_count"] = beams
            else:
                for index in (3, 4):
                    columns[index]["rhythm"]["beam_count"] = 2
            readings.extend((initial, correct if corrected else copy.deepcopy(initial)))
        return readings

    def test_pixel_beam_disagreements_get_bounded_review_and_preserve_initial_results(self):
        self.samples = recognition_lab.prepare_samples()
        count, status, summary, report, _ = self.run_mocked(
            [self.fake_response(content=json.dumps(r)) for r in self.beam_review_readings()], mode="rhythm_beams_verified")
        self.assertEqual(count, 4)
        self.assertEqual(status["status"], "complete")
        results = summary["results"]
        self.assertEqual(results[0]["rhythm_comparison"]["beam_counts_correct"], 7)
        self.assertEqual(results[2]["rhythm_comparison"]["beam_counts_correct"], 8)
        self.assertEqual([len(results[i]["beam_review_changes"]) for i in (1, 3)], [3, 2])
        for i in (1, 3):
            self.assertTrue(results[i]["beam_cross_check"]["consistent"])
            self.assertEqual(results[i]["rhythm_comparison"]["rhythm_correct"], 10)
            self.assertNotIn("compiled_score", results[i])
        for i in (0, 2):
            text = self.last_payloads[i]["messages"][1]["content"][0]["text"]
            self.assertNotIn("<pixel_evidence>", text)
            self.assertNotIn("<draft_json>", text)
            reviewed = self.last_payloads[i + 1]["messages"][1]["content"][0]["text"]
            self.assertIn("<pixel_evidence>", reviewed)
            self.assertIn("<draft_json>", reviewed)
            self.assertNotIn('"duration"', reviewed)
        self.assertIn("原图像素独立核查", report)
        self.assertIn("横梁复核的实际改动", report)

    def test_beam_review_agreement_skips_both_optional_paid_calls(self):
        from test_rhythm_diagnostic import reference_rhythm
        self.samples = recognition_lab.prepare_samples()
        count, status, summary, _, _ = self.run_mocked(
            [self.fake_response(content=json.dumps(reference_rhythm(n)[0])) for n in (1, 4)], mode="rhythm_beams_verified")
        self.assertEqual(count, 2)
        self.assertEqual(status["status"], "complete")
        self.assertEqual(len(summary["results"]), 2)
        self.assertTrue(all(r["beam_cross_check"]["consistent"] for r in summary["results"]))

    def test_unconfirmed_pixel_candidates_are_not_automatically_applied(self):
        self.samples = recognition_lab.prepare_samples()
        count, _, summary, _, _ = self.run_mocked(
            [self.fake_response(content=json.dumps(r)) for r in self.beam_review_readings(corrected=False)], mode="rhythm_beams_verified")
        self.assertEqual(count, 4)
        for index in (1, 3):
            self.assertEqual(summary["results"][index]["beam_review_changes"], [])
            self.assertFalse(summary["results"][index]["beam_cross_check"]["consistent"])
            self.assertEqual(summary["results"][index]["rhythm_comparison"]["valid_timelines"], 0)

    def test_illegal_beam_review_stops_before_next_measure_and_keeps_initial(self):
        self.samples = recognition_lab.prepare_samples()
        readings = self.beam_review_readings()
        readings[1]["metadata"]["capo"] = 0
        count, status, summary, _, _ = self.run_mocked(
            [self.fake_response(content=json.dumps(r)) for r in readings[:2]], mode="rhythm_beams_verified")
        self.assertEqual(count, 2)
        self.assertEqual(status["status"], "needs_attention")
        self.assertEqual(summary["results"][0]["rhythm_comparison"]["beam_counts_correct"], 7)
        self.assertEqual(summary["results"][1]["status"], "symbol_format_error")

    def test_invalid_initial_beam_reading_stops_before_review(self):
        self.samples = recognition_lab.prepare_samples()
        count, status, _, _, _ = self.run_mocked([self.fake_response()], mode="rhythm_beams_verified")
        self.assertEqual(count, 1)
        self.assertEqual(status["status"], "needs_attention")

    def test_invalid_cell_output_stops_before_rhythm_request(self):
        from test_cell_reader import reference_cells
        cells = reference_cells()
        cells["measures"][0]["string_rows"][0]["cells"].pop()
        self.samples = recognition_lab.prepare_samples()
        count, status, summary, _, _ = self.run_mocked(
            [self.fake_response(content=json.dumps(cells))], mode="cells_pipeline")
        self.assertEqual(count, 1)
        self.assertEqual(status["status"], "needs_attention")
        self.assertEqual(summary["results"][0]["status"], "symbol_format_error")


if __name__ == "__main__":
    unittest.main()
