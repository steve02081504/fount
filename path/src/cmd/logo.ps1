function script:cmd_logo {
	require terminal deno
	$iconAnime = "$FOUNT_DIR/imgs/icon_anime/index.mjs"
	$originalTitle = Get-Title
	try {
		Set-Title '𝒻ℴ𝓊𝓃𝓉 𝓵𝓸𝓰𝓸'
		$watchArgs = @()
		if (@($args | Select-Object -Skip 1)[0] -eq 'watch') { $watchArgs = @('--watch') }
		deno run @watchArgs --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" $iconAnime
	}
	finally {
		Set-Title $originalTitle
	}
	exit $LastExitCode
}
