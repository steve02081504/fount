function script:cmd_log {
	require win/app_restart deno
	bootstrap_full @args
	try {
		Register-FountApplicationRestart
		deno run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" "$FOUNT_DIR/src/log_viewer/index.mjs" @($args | Select-Object -Skip 1)
	}
	finally {
		Unregister-FountApplicationRestart
	}
	exit $LastExitCode
}
