function script:cmd_logo {
	require terminal deno
	install_deno
	$iconAnime = "$FOUNT_DIR/imgs/icon_anime/index.mjs"
	$originalTitle = Get-Title
	try {
		Set-Title '𝒻ℴ𝓊𝓃𝓉 𝓵𝓸𝓰𝓸'
		$denoRunArgs = @('--allow-scripts', '--allow-all', '-c', "$FOUNT_DIR/deno.json", $iconAnime)
		if (@($args | Select-Object -Skip 1)[0] -eq 'watch') { $denoRunArgs = @('--watch') + $denoRunArgs }
		deno run @denoRunArgs
	}
	finally {
		Set-Title $originalTitle
	}
	exit $LastExitCode
}
