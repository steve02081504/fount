function script:cmd_update {
	require_mid
	$target = @($args | Select-Object -Skip 1)[0]
	if ($target) {
		fount_update_to_ref $target
	}
	else {
		update_fount_and_deno
	}
}
