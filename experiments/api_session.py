"""Masked local credential session; Codex sends bounded jobs without seeing keys."""

import argparse
import json
import os
from pathlib import Path
import queue
import threading

from session_control import ControlError, claim_request, run_request, validate_request


BASE_DIR = Path(__file__).resolve().parent
REQUEST_PATH = BASE_DIR / "control_request.json"
STATUS_PATH = BASE_DIR / "session_status.json"
RESULT_DIR = BASE_DIR / "control_results"


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def open_session(smoke_test=False):
    import tkinter as tk
    from tkinter import messagebox, ttk

    root = tk.Tk()
    root.title("吉他谱本地实验会话 · 密钥仅存内存")
    root.geometry("740x530")
    outer = ttk.Frame(root, padding=22)
    outer.pack(fill="both", expand=True)
    ttk.Label(outer, text="连接一次本地会话，后续实验由 Codex 发起", font=("Microsoft YaHei UI", 15, "bold")).pack(anchor="w")
    ttk.Label(outer, text="密钥只留在这个窗口的内存里，不写入任务、文件或命令行。\n每个任务最多2轮，每轮最多4次API请求；失败不重试。任务和报告可查看。",
              wraplength=690).pack(anchor="w", pady=(12, 14))
    ttk.Label(outer, text="DeepSeek 官方 API Key").pack(anchor="w")
    entry = ttk.Entry(outer, show="*", width=80)
    entry.pack(fill="x", pady=(6, 12))
    buttons = ttk.Frame(outer)
    buttons.pack(fill="x")
    connect_button = ttk.Button(buttons, text="连接实验会话")
    connect_button.pack(side="left")
    disconnect_button = ttk.Button(buttons, text="断开并停止后续请求")
    disconnect_button.pack(side="left", padx=12)
    state_label = ttk.Label(outer, text="等待本地输入密钥。")
    state_label.pack(anchor="w", pady=(16, 6))
    task_label = ttk.Label(outer, wraplength=690)
    task_label.pack(anchor="w", pady=(0, 10))
    log = tk.Text(outer, height=8, wrap="word", state="disabled", font=("Microsoft YaHei UI", 10))
    log.pack(fill="both", expand=True)
    ttk.Label(outer, text="实验结束后请保持此窗口打开，可以最小化。关闭会清除密钥，下轮需重新输入。连接后排队任务按服务商用量计费。", wraplength=690).pack(anchor="w", pady=(10, 0))
    events = queue.Queue()
    cancelled = threading.Event()
    session_secret = ""
    active = False
    active_task = None
    latest_task = None
    last_task_error = False

    def status(state, **fields):
        write_json(STATUS_PATH, {"state": state, "pid": os.getpid(),
                                 "credential_in_memory": bool(session_secret), **fields})

    def append(message):
        log.configure(state="normal")
        log.insert("end", message + "\n")
        log.see("end")
        log.configure(state="disabled")

    def connect():
        nonlocal session_secret
        if active:
            return
        entered = entry.get().strip()
        if not entered or any(c.isspace() for c in entered):
            messagebox.showinfo("输入密钥", "请在本地输入框粘贴密钥本身。", parent=root)
            return
        session_secret = entered
        entered = ""
        entry.delete(0, "end")
        state_label.configure(text="密钥已留在本窗口内存；可复用，身份验证在实际请求时完成。")
        status("ready")
        append("本地会话已连接。任务文件不包含密钥。")

    def disconnect():
        nonlocal session_secret
        cancelled.set()
        session_secret = ""
        entry.delete(0, "end")
        state_label.configure(text="会话已断开，后续请求停止。")
        status("disconnecting" if active else "waiting_for_key")

    def worker(secret, request, claim):
        try:
            result = run_request(secret, request, lambda kind, data: events.put((kind, data)), cancelled)
        except Exception:
            # Exception/local variable dumps can contain credentials; never log them.
            result = {"state": "needs_attention", "task": request, "runs": [],
                      "message": "任务加载或执行失败；停止后续请求，密钥未写入结果"}
        write_json(claim, result)
        events.put(("task_finished", result))
        secret = ""

    def poll():
        nonlocal active, active_task, latest_task, last_task_error
        try:
            while True:
                kind, data = events.get_nowait()
                if kind == "log":
                    append(str(data))
                elif kind == "task_finished":
                    active = False
                    connect_button.configure(state="normal")
                    state_label.configure(text="任务结束；请保留此窗口（可最小化），回到Codex检查结果。")
                    status("task_complete" if data["state"] == "complete" else "needs_attention", result=data)
                    append("任务结束，报告和任务结果已保存。")
                    active_task = None
        except queue.Empty:
            pass
        if not active and REQUEST_PATH.is_file():
            try:
                request = validate_request(json.loads(REQUEST_PATH.read_text(encoding="utf-8")))
                claim_path = RESULT_DIR / (request["id"] + ".json")
                if not claim_path.exists():
                    if latest_task != request["id"]:
                        latest_task = request["id"]
                        name = {"rhythm_beams_verified": "原图像素与模型横梁核查",
                                "rhythm_contrast_compare": "原灰度与提亮横梁对照",
                                "rhythm_groups_compare": "完整谱行与整组横梁放大对照",
                                "rhythm_prompt_compare": "节奏提示词对照", "rhythm_diagnostic": "混合节奏诊断",
                                "cells_verified": "音符独立核查",
                                "duvet_probe": "新曲目整页通用提示词试读"}.get(request["mode"], "谱图识别实验")
                        task_label.configure(text=f"排队任务：{name}，{request['rounds']}轮，最多{4 * request['rounds']}次请求。")
                        status("task_waiting_for_key" if not session_secret else "ready", task=request)
                    if session_secret:
                        claim = claim_request(request, RESULT_DIR)
                        if claim is not None:
                            active = True
                            active_task = request
                            cancelled.clear()
                            connect_button.configure(state="disabled")
                            state_label.configure(text="正在执行本地任务；输入框清空后仍复用会话密钥。")
                            status("running", task=request)
                            threading.Thread(target=worker, args=(session_secret, request, claim), daemon=True).start()
                last_task_error = False
            except (ControlError, ValueError, OSError):
                if not last_task_error:
                    append("任务文件格式不符合约定，未发送请求。")
                    status("needs_attention", message="任务文件格式错误")
                    last_task_error = True
        root.after(200, poll)

    def close():
        if active and not messagebox.askyesno("停止实验", "关闭会停止后续请求，已经发出的请求仍可能计费。确定关闭？", parent=root):
            return
        disconnect()
        status("closed")
        root.destroy()

    connect_button.configure(command=connect)
    disconnect_button.configure(command=disconnect)
    root.protocol("WM_DELETE_WINDOW", close)
    root.update_idletasks()
    if smoke_test:
        print(json.dumps({"gui": "ok", "widgets_fit": outer.winfo_reqheight() <= root.winfo_height(),
                          "api_requests_sent": 0}))
        root.destroy()
        return
    status("waiting_for_key")
    root.after(200, poll)
    root.mainloop()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--smoke-gui", action="store_true")
    open_session(parser.parse_args().smoke_gui)
