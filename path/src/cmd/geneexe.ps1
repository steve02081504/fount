function script:cmd_geneexe {
	require_mid
	fount_first_install_if_needed @args
	New-FountExe $args[1]
}
