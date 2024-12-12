#_pragma icon $PSScriptRoot/../public/icon.ico
#_pragma title "fount"

if (!(Get-Command fount.ps1 -ErrorAction Ignore)) {
	Remove-Item $env:LOCALAPPDATA/fount -Confirm -ErrorAction Ignore -Recurse
	if (Get-Command git -ErrorAction Ignore) {
		git clone https://github.com/steve02081504/fount $env:LOCALAPPDATA/fount --depth 1
		if ($LASTEXITCODE -ne 0) {
			$Host.UI.WriteErrorLine("下载错误 终止脚本")
			exit 1
		}
	}
	else {
		Remove-Item $env:TEMP/fount-master -Force -ErrorAction Ignore -Confirm:$false -Recurse
		try { Invoke-WebRequest https://github.com/steve02081504/fount/archive/refs/heads/master.zip -OutFile $env:TEMP/fount.zip }
		catch {
			$Host.UI.WriteErrorLine("下载错误 终止脚本")
			exit 1
		}
		Expand-Archive $env:TEMP/fount.zip $env:TEMP -Force
		Remove-Item $env:TEMP/fount.zip -Force
		Move-Item $env:TEMP/fount-master $env:LOCALAPPDATA/fount -Force
	}
	$Script:fountDir = "$env:LOCALAPPDATA/fount"
}
else {
	$Script:fountDir = (Get-Command fount.ps1).Path | Split-Path -Parent | Split-Path -Parent
}

. "$fountDir/path/fount.ps1" @args
