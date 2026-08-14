function script:cmd_geneexe {
	require_mid
	fount_first_install_if_needed @args
	require win/fount_exe
	New-FountExe $args[1]
}
