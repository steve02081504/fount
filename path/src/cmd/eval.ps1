function script:cmd_eval {
	require deno
	bootstrap_full @args
	deno run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" "$FOUNT_DIR/src/scripts/eval.mjs" @($args | Select-Object -Skip 1)
	exit $LastExitCode
}
