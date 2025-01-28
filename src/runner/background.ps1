#!pwsh
#_pragma icon $PSScriptRoot/../public/favicon.ico
#_pragma title "fount background"
#_pragma Console 0

if (Get-Command fount.ps1 -ErrorAction Ignore) {
	fount @args *>&1 | Out-Null
}
else {
	"this exe requires fount installed"
}
