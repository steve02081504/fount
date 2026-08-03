function script:Invoke-FountCmdTest {
	RequireMany win/keep_awake terminal deno
	$originalTitle = Get-Title
	Set-Title '𝒻ℴ𝓊𝓃𝓉 𝓽𝓮𝓼𝓉'
	Enable-FountTestKeepAwake
	$testExit = 0
	try {
		deno run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" "$FOUNT_DIR/src/scripts/test/cli.mjs" @(if ($args.Count -gt 1) { $args[1..($args.Count - 1)] })
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
