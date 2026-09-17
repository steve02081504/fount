#!/usr/bin/env bash
# `fount eval`：调共享 WS 客户端 `src/scripts/eval.mjs`（流式）；报错文案由客户端按需惰性读取 locale。
cmd_eval() {
	bootstrap_full "$@"
	require deno
	run_deno run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" "$FOUNT_DIR/src/scripts/eval.mjs" "${@:2}"
	exit $?
}
