"""Bounded subscription-only Claude artist commissions; never shell through claude.cmd."""
from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

REPO = Path(__file__).resolve().parents[1]
MODELS = ("claude-sonnet-5-5", "claude-opus-5-5")


def clean_environment() -> dict[str, str]:
    return {k: v for k, v in os.environ.items()
            if not k.upper().startswith(("ANTHROPIC_", "CLAUDE_CODE_USE_"))
            and k.upper() != "CLAUDE_CODE_OAUTH_TOKEN"}


def executable() -> str:
    shim = shutil.which("claude")
    if not shim:
        raise RuntimeError("Claude CLI is not installed.")
    native = Path(shim).parent / "node_modules/@anthropic-ai/claude-code/bin/claude.exe"
    if native.is_file():
        return str(native)
    if os.name == "nt" and Path(shim).suffix.lower() in (".cmd", ".bat", ".ps1"):
        raise RuntimeError("A direct Claude executable is required for reliable process-tree timeout.")
    return shim


def stop_tree(process: subprocess.Popen) -> None:
    if os.name == "nt":
        # PID is the direct executable we just launched, not a shared shell.
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15,
                       creationflags=subprocess.CREATE_NO_WINDOW)
    elif process.poll() is None:
        import signal
        os.killpg(process.pid, signal.SIGKILL)
    process.wait(timeout=15)


def run(commission: Path, model: str, turns: int, effort: str, seconds: float) -> dict:
    work = (REPO / "work").resolve()
    commission = commission.resolve()
    if not commission.is_relative_to(work):
        raise ValueError("Commission must be an isolated folder under this project's work/.")
    brief = commission / "BRIEF.md"
    if not brief.is_file():
        raise FileNotFoundError(brief)
    env = clean_environment()
    exe = executable()
    kwargs = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {"start_new_session": True}
    auth = subprocess.run([exe, "auth", "status"], cwd=commission, env=env,
                          capture_output=True, text=True, encoding="utf-8", timeout=30, **kwargs)
    identity = json.loads(auth.stdout)
    if (auth.returncode != 0 or not identity.get("loggedIn")
            or identity.get("authMethod") != "claude.ai"
            or identity.get("email") != "fauxgrady@gmail.com"
            or identity.get("subscriptionType") not in ("pro", "max")
            or identity.get("apiKeySource") not in (None, "", "none")):
        raise RuntimeError("Expected personal Claude.ai subscription not verified; no generation submitted.")
    started = time.perf_counter()
    metadata = {"account": identity["email"], "auth_method": identity["authMethod"],
                "subscription": identity["subscriptionType"], "requested_model": model,
                "time_cap_seconds": seconds, "output": str(commission), "outcome": "running"}
    try:
        with (commission / "commission.jsonl").open("w", encoding="utf-8") as log:
            process = subprocess.Popen([exe, "--print", "--model", model, "--effort", effort,
                "--permission-mode", "acceptEdits", "--allowedTools", "Read,Write,Edit,Glob,Grep,Bash,PowerShell",
                "--strict-mcp-config", "--output-format", "stream-json", "--verbose", "--max-turns", str(turns)],
                cwd=commission, env=env, stdin=subprocess.PIPE, stdout=log, stderr=log,
                text=True, encoding="utf-8", **kwargs)
            metadata["pid"] = process.pid
            # A later coordinator can identify the exact owned process without
            # opening raw model streams or starting a duplicate commission.
            (commission / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
            try:
                process.communicate(brief.read_text(encoding="utf-8-sig"), timeout=seconds)
            except subprocess.TimeoutExpired:
                stop_tree(process)
                metadata["outcome"] = "timeout"
            metadata["exit_code"] = process.returncode
        events = []
        for line in (commission / "commission.jsonl").read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass
        init = next((e for e in events if e.get("type") == "system" and e.get("subtype") == "init"), {})
        final = next((e for e in reversed(events) if e.get("type") == "result"), {})
        metadata["actual_model"] = init.get("model", "")
        metadata["canonical_model"] = final.get("modelUsage", {}).get(model, {}).get("canonicalModel", "")
        metadata["model_verified"] = metadata["actual_model"] == model
        metadata["final_verified"] = metadata["canonical_model"] == model and not final.get("is_error", True)
        if process.returncode == 0 and metadata["model_verified"] and metadata["final_verified"]:
            metadata["outcome"] = "passed"
        elif metadata["outcome"] != "timeout":
            metadata["outcome"] = "failed"
            metadata["reason"] = str(final.get("result") or "; ".join(final.get("errors", [])) or final.get("subtype") or "No verified final result")[:500]
    finally:
        metadata["elapsed_seconds"] = round(time.perf_counter() - started, 3)
        (commission / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
        (REPO / "logs").mkdir(exist_ok=True)
        with (REPO / "logs/work-timing.csv").open("a", newline="", encoding="utf-8") as out:
            csv.writer(out).writerow(["claude-commission-" + commission.name, metadata["outcome"], metadata["elapsed_seconds"]])
    return metadata


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("commission", type=Path)
    parser.add_argument("--model", choices=MODELS, default=MODELS[0])
    parser.add_argument("--max-turns", type=int, default=28)
    parser.add_argument("--effort", choices=("low", "medium", "high"), default="high")
    parser.add_argument("--seconds", type=float, default=600)
    args = parser.parse_args()
    metadata = run(args.commission, args.model, args.max_turns, args.effort, args.seconds)
    print("CLAUDE_COMMISSION_RESULT " + json.dumps(metadata))
    return 0 if metadata["outcome"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
