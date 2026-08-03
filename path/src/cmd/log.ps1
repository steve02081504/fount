function script:Invoke-FountCmdLog {
	param([string[]]$CommandArgs)
	. $FountRequireMany win/app_restart deno
	try {
		Register-FountApplicationRestart
		deno run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" "$FOUNT_DIR/src/log_viewer/index.mjs"
	}
	finally {
		Unregister-FountApplicationRestart
	}
	exit $LastExitCode
}
