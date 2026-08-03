function script:Invoke-FountCmdLogo {
	$iconAnime = "$FOUNT_DIR/imgs/icon_anime/index.mjs"
	$originalTitle = Get-Title
	try {
		Set-Title '𝒻ℴ𝓊𝓃𝓉 𝓵𝓸𝓰𝓸'
		if ($args[1] -eq 'watch') {
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
