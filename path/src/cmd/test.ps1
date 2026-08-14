function script:cmd_test {
	require win/keep_awake terminal deno
	$originalTitle = Get-Title
	$testExit = 0
	try {
		Set-Title '𝒻ℴ𝓊𝓃𝓉 𝓽𝓮𝓼𝓉'
		if (@($args | Select-Object -Skip 1) -notcontains '--watch') { Enable-FountTestKeepAwake }
		install_deno
		deno_upgrade canary
		deno run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" "$FOUNT_DIR/src/scripts/test/cli.mjs" @($args | Select-Object -Skip 1)
		$testExit = $LastExitCode
	}
	finally {
		Disable-FountTestKeepAwake
		Set-Title $originalTitle
		if ($testExit -eq 0) { Write-TaskbarProgressClear }
		if ($script:TaskbarProgressEnabled) { Write-Host -NoNewline $script:TaskbarProgressBel }
	}
	exit $testExit
}
