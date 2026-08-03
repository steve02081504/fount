function script:cmd_test {
	require win/keep_awake terminal deno
	$originalTitle = Get-Title
	Set-Title '𝒻ℴ𝓊𝓃𝓉 𝓽𝓮𝓼𝓉'
	Enable-FountTestKeepAwake
	$testExit = 0
	try {
		$args = @($args | Select-Object -Skip 1)
		deno run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" "$FOUNT_DIR/src/scripts/test/cli.mjs" @args
		$testExit = $LASTEXITCODE
	}
	finally {
		Disable-FountTestKeepAwake
		Set-Title $originalTitle
		if ($testExit -eq 0) { Write-TaskbarProgressClear }
		if ($script:TaskbarProgressEnabled) { Write-Host -NoNewline $script:TaskbarProgressBel }
	}
	exit $testExit
}
