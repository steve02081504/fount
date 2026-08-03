function script:cmd_logo {
	require deno
	$iconAnime = "$FOUNT_DIR/imgs/icon_anime/index.mjs"
	$originalTitle = Get-Title
	try {
		Set-Title '𝒻ℴ𝓊𝓃𝓉 𝓵𝓸𝓰𝓸'
		if (@($args | Select-Object -Skip 1)[0] -eq 'watch') {
			deno run --watch --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" $iconAnime
		}
		else {
			deno run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" $iconAnime
		}
	}
	finally {
		Set-Title $originalTitle
	}
	exit $LastExitCode
}
