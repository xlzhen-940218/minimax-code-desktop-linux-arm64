#!/usr/bin/env python3
"""Minimal request-shape checks for the bundled llm-call script."""

from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path


httpx_stub = types.ModuleType("httpx")
httpx_stub.Client = object
sys.modules["httpx"] = httpx_stub

yaml_stub = types.ModuleType("yaml")
yaml_stub.safe_load = lambda _: {}
sys.modules["yaml"] = yaml_stub

SCRIPT_PATH = (
    Path(__file__).resolve().parents[2]
    / "assets/skills/llm-call/scripts/llm_call.py"
)
spec = importlib.util.spec_from_file_location("llm_call_under_test", SCRIPT_PATH)
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


assert module.NPM_TO_PROTOCOL["@ai-sdk/anthropic"] == "anthropic"
protocol = module.MessagesProtocol()
messages = [
    {"role": "system", "content": "Follow the policy."},
    {"role": "user", "content": "Hello."},
    {"role": "assistant", "content": "Hi."},
]

url, headers, body = protocol.build_request(
    "https://example.invalid/base/",
    "MiniMax-M3",
    messages,
    max_tokens=128,
    temperature=0.2,
    stream=True,
)
assert url == "https://example.invalid/base/messages"
assert headers == {"Content-Type": "application/json"}
assert body == {
    "model": "MiniMax-M3",
    "max_tokens": 128,
    "messages": messages[1:],
    "system": "Follow the policy.",
    "temperature": 0.2,
    "stream": True,
}

_, merged_headers, _ = protocol.build_request(
    "https://example.invalid",
    "MiniMax-M3",
    [{"role": "user", "content": "Hello."}],
    extra_headers={"X-Trace": "request-shape"},
)
assert merged_headers == {
    "Content-Type": "application/json",
    "X-Trace": "request-shape",
}

print("llm-call request shape: PASS")
