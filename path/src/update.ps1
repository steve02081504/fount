function script:update_fount_and_deno {
	if (Test-Path -Path "$FOUNT_DIR/.noupdate") {
		Write-Host (Get-I18n -key 'update.skippingFountUpdate')
	}
	else {
		fount_upgrade
		deno_upgrade
	}
}
