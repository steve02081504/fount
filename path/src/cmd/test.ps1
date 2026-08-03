function script:Invoke-FountCmdTest {
	param([string[]]$CommandArgs)
	Invoke-FountBootstrapFull -CommandArgs $CommandArgs
	$originalTitle = Get-Title
	Set-Title '𝒻ℴ𝓊𝓃𝓉 𝓽𝓮𝓼𝓽'
	Enable-FountTestKeepAwake
	$testExit = 0
	try {
		deno run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" "$FOUNT_DIR/src/scripts/test/cli.mjs" @(if ($CommandArgs.Count -gt 1) { $CommandArgs[1..($CommandArgs.Count - 1)] })
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
