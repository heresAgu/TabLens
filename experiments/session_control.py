"""Local experiment requests contain task settings, never API credentials."""

import importlib
import json
import re
import sys
from pathlib import Path


class ControlError(ValueError):
    pass


def validate_request(value):
    if not isinstance(value, dict) or set(value) != {"id", "mode", "rounds"}:
        raise ControlError("任务只能包含id、mode、rounds，不接受密钥或其他字段")
    if not isinstance(value["id"], str) or not re.fullmatch(r"[0-9a-f]{32}", value["id"]):
        raise ControlError("任务标识必须为随机生成的32位十六进制字符串")
    if not isinstance(value["mode"], str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", value["mode"]):
        raise ControlError("任务模式格式错误")
    if type(value["rounds"]) is not int or not 1 <= value["rounds"] <= 2:
        raise ControlError("每个任务只允许1～2轮，不自动增加轮数")
    return dict(value)


def load_fresh_lab():
    # The session GUI keeps the credential; reload experiment code independently.
    for name in ["symbol_reader", "string_verifier", "string_anchors", "event_pipeline",
                 "cell_reader", "cell_verifier", "beam_evidence", "rhythm_diagnostic", "recognition_lab"]:
        if name in sys.modules:
            importlib.reload(sys.modules[name])
        else:
            importlib.import_module(name)
    return sys.modules["recognition_lab"]


def claim_request(request, result_dir):
    """Create the claim before any network call; a used ID cannot execute again."""
    request = validate_request(request)
    result_dir = Path(result_dir)
    result_dir.mkdir(parents=True, exist_ok=True)
    path = result_dir / (request["id"] + ".json")
    try:
        with path.open("x", encoding="utf-8") as stream:
            json.dump({"state": "claimed", "task": request}, stream)
    except FileExistsError:
        return None
    return path


def run_request(secret, request, emit, cancelled, loader=load_fresh_lab):
    request = validate_request(request)
    if not secret or any(character.isspace() for character in secret):
        raise ControlError("本地会话没有可用密钥，未发送请求")
    lab = loader()
    cases = lab.experiment_cases(lab.prepare_samples(), request["mode"])
    if not 1 <= len(cases) <= 4:
        raise ControlError("每轮最多允许4次请求，当前任务未执行")
    runs = []
    for round_index in range(request["rounds"]):
        if cancelled.is_set():
            break
        completion = None

        def receive(kind, data):
            nonlocal completion
            safe = lab.redact(data, secret)
            if kind == "done":
                completion = safe
            emit(kind, safe)

        emit("log", f"本地任务：第{round_index + 1}/{request['rounds']}轮，最多{len(cases)}次API调用。")
        lab.run_experiment(secret, receive, cancelled, request["mode"])
        if completion is None:
            return {"state": "needs_attention", "task": request, "runs": runs,
                    "message": "实验没有完成状态，停止后续轮次"}
        runs.append(completion)
        if completion["state"] != "complete":
            break
    state = "cancelled" if cancelled.is_set() else (
        "complete" if len(runs) == request["rounds"] and all(r["state"] == "complete" for r in runs) else "needs_attention")
    return {"state": state, "task": request, "runs": runs, "maximum_api_calls": len(cases) * request["rounds"]}
