"""
OpenAI-compatible mock server for fount testing.

Supports:
- POST /v1/chat/completions
- stream: true (SSE) and stream: false
- logprobs + top_logprobs

No third-party dependencies required.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


def now_ts() -> int:
    return int(time.time())


def clamp_int(value: Any, low: int, high: int, default: int) -> int:
    try:
        v = int(value)
    except Exception:
        return default
    return max(low, min(high, v))


def split_tokens(text: str) -> list[str]:
    # Character-level split keeps behavior stable for mixed CJK/emoji tests.
    return list(text or "")


def bytes_of_token(token: str) -> list[int]:
    return list(token.encode("utf-8"))


def build_top_candidates(selected: str, n: int, rng: random.Random, selected_lp: float) -> list[dict[str, Any]]:
    if n <= 0:
        return []
    pool = [
        selected,
        " ",
        "。",
        "！",
        "？",
        ",",
        ".",
        "好",
        "的",
        "嗯",
    ]
    uniq: list[str] = []
    for t in pool:
        if t not in uniq:
            uniq.append(t)
    rows: list[dict[str, Any]] = []
    for i, tok in enumerate(uniq[:n]):
        if tok == selected:
            lp = selected_lp
        else:
            # Keep alternatives lower-probability than selected token.
            lp = selected_lp - rng.uniform(0.2, 3.2) - (i * 0.03)
        rows.append({"token": tok, "logprob": lp})
    if selected not in [x["token"] for x in rows]:
        rows[-1] = {"token": selected, "logprob": selected_lp}
    rows.sort(key=lambda x: x["logprob"], reverse=True)
    return rows


def make_logprob_item(token: str, top_n: int, rng: random.Random) -> dict[str, Any]:
    # Randomized confidence to avoid "all green" UI.
    selected_lp = -rng.uniform(0.02, 1.8)
    return {
        "token": token,
        "logprob": selected_lp,
        "bytes": bytes_of_token(token),
        "top_logprobs": build_top_candidates(token, top_n, rng, selected_lp),
    }


def extract_text_from_message_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "text":
                parts.append(str(item.get("text", "")))
        return "".join(parts)
    return ""


def strip_transport_markup(text: str) -> str:
    """
    Remove fount transport wrappers / HTML-ish tags from echoed text.
    Keeps user-visible plain content for easier UI debugging.
    """
    if not text:
        return text
    content_blocks = re.findall(r"<content>([\s\S]*?)</content>", text, flags=re.IGNORECASE)
    if content_blocks:
        text = content_blocks[-1]
    text = re.sub(r"</sender>\s*<content>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</content>\s*</message[^>]*>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"</?message[^>]*>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"</?sender[^>]*>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"</?content[^>]*>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"</?p[^>]*>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return text.strip()


def build_completion_text(messages: list[dict[str, Any]]) -> str:
    user_text = ""
    for msg in reversed(messages or []):
        if isinstance(msg, dict) and msg.get("role") == "user":
            user_text = extract_text_from_message_content(msg.get("content"))
            break
    user_text = strip_transport_markup(user_text).strip()
    if not user_text:
        user_text = "Hello from mock server."
    return f"Mock reply: {user_text}"


def count_prompt_chars(messages: list[dict[str, Any]]) -> int:
    total = 0
    for msg in messages or []:
        if not isinstance(msg, dict):
            continue
        total += len(extract_text_from_message_content(msg.get("content")))
    return total


class OpenAIMockHandler(BaseHTTPRequestHandler):
    server_version = "OpenAIMock/1.0"
    protocol_version = "HTTP/1.1"

    def _set_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._set_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_sse_headers(self) -> None:
        self.send_response(200)
        self._set_cors_headers()
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()

    def _sse(self, obj: dict[str, Any]) -> None:
        line = f"data: {json.dumps(obj, ensure_ascii=False)}\n\n".encode("utf-8")
        self.wfile.write(line)
        self.wfile.flush()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._set_cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path in ("/health", "/healthz"):
            self._send_json(200, {"ok": True, "time": now_ts()})
            return
        self._send_json(404, {"error": {"message": "Not Found"}})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/v1/chat/completions":
            self._send_json(404, {"error": {"message": "Unknown endpoint"}})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length > 0 else b"{}"
            req = json.loads(raw.decode("utf-8"))
        except Exception as e:
            self._send_json(400, {"error": {"message": f"Invalid JSON: {e}"}})
            return

        model = str(req.get("model", "mock-model"))
        messages = req.get("messages", [])
        stream = bool(req.get("stream", False))
        with_logprobs = bool(req.get("logprobs", False))
        top_n = clamp_int(req.get("top_logprobs", 0), 0, 20, 0)
        delay_ms = clamp_int(req.get("mock_delay_ms", 1000), 0, 5000, 1000)
        seed = req.get("mock_seed")
        rng = random.Random(seed if seed is not None else time.time_ns())

        text = build_completion_text(messages)
        tokens = split_tokens(text)
        completion_logprobs = [make_logprob_item(t, top_n, rng) for t in tokens] if with_logprobs else []

        completion_id = f"chatcmpl-mock-{uuid.uuid4().hex[:12]}"
        created = now_ts()
        usage = {
            "prompt_tokens": count_prompt_chars(messages),
            "completion_tokens": len(tokens),
            "total_tokens": count_prompt_chars(messages) + len(tokens),
        }

        if not stream:
            payload: dict[str, Any] = {
                "id": completion_id,
                "object": "chat.completion",
                "created": created,
                "model": model,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": text},
                        "finish_reason": "stop",
                    }
                ],
                "usage": usage,
            }
            if with_logprobs:
                payload["choices"][0]["logprobs"] = {"content": completion_logprobs}
            self._send_json(200, payload)
            return

        try:
            self._send_sse_headers()

            # First role chunk (common OpenAI-compatible behavior)
            self._sse(
                {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": model,
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"role": "assistant"},
                            "finish_reason": None,
                        }
                    ],
                }
            )

            for i, token in enumerate(tokens):
                chunk: dict[str, Any] = {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": model,
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"content": token},
                            "finish_reason": None,
                        }
                    ],
                }
                if with_logprobs:
                    chunk["choices"][0]["logprobs"] = {"content": [completion_logprobs[i]]}
                self._sse(chunk)
                if delay_ms > 0:
                    time.sleep(delay_ms / 1000.0)

            # Final chunk
            self._sse(
                {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": model,
                    "choices": [
                        {
                            "index": 0,
                            "delta": {},
                            "finish_reason": "stop",
                        }
                    ],
                    "usage": usage,
                }
            )
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            # Client disconnected; ignore.
            return


def main() -> None:
    parser = argparse.ArgumentParser(description="OpenAI-compatible mock chat server")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host")
    parser.add_argument("--port", type=int, default=18000, help="Bind port")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), OpenAIMockHandler)
    print(f"[mock-openai] listening on http://{args.host}:{args.port}")
    print("[mock-openai] endpoint: POST /v1/chat/completions")
    print("[mock-openai] health:   GET  /health")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("[mock-openai] stopped")


if __name__ == "__main__":
    main()
