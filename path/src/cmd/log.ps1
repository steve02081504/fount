function script:Invoke-FountCmdLog {
	RequireMany win/app_restart deno
	Invoke-FountBootstrapFull @args
	try {
		Register-FountApplicationRestart
		deno run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" "$FOUNT_DIR/src/log_viewer/index.mjs"
	}
	finally {
		Unregister-FountApplicationRestart
	}
	exit $LastExitCode
}
