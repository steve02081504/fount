function script:update_fount_and_deno {
	if (Test-Path -Path "$FOUNT_DIR/.noupdate") {
		Write-Host (Get-I18n -key 'update.skippingFountUpdate')
		return
	}
	fount_upgrade
	deno_upgrade
}

# After the first successful deno upgrade, routine starts refresh in the background.
function script:update_fount_and_deno_background {
	if (Test-Path -Path "$FOUNT_DIR/.noupdate") {
		Write-Host (Get-I18n -key 'update.skippingFountUpdate')
		return
	}
	$upgradedFlag = Join-Path $FOUNT_DIR 'data/installer/deno_upgraded'
	if (Test-Path $upgradedFlag) {
		# Start-Job cannot call in-process functions; re-enter via `fount update`.
		Start-Job -ScriptBlock {
			param($fountPs1)
			& $fountPs1 update
		} -ArgumentList (Join-Path $FOUNT_DIR 'path/fount.ps1') | Out-Null
		return
	}
	update_fount_and_deno
}
