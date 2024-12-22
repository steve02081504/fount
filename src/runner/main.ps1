#!pwsh
#_pragma icon $PSScriptRoot/../public/favicon.ico
#_pragma title "fount"
#_pragma outputfile $PSScriptRoot/fount.exe

if (!$env:FOUNT_DIR) {
	$env:FOUNT_DIR = "$env:LOCALAPPDATA/fount"
}

if (!(Get-Command fount.ps1 -ErrorAction Ignore)) {
	Remove-Item $env:FOUNT_DIR -Confirm -ErrorAction Ignore -Recurse
	if (Get-Command git -ErrorAction Ignore) {
		git clone https://github.com/steve02081504/fount $env:FOUNT_DIR --depth 1
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
		# 确保父文件夹存在
		New-Item $(Split-Path -Parent $env:FOUNT_DIR) -ItemType Directory -Force -ErrorAction Ignore
		Move-Item $env:TEMP/fount-master $env:FOUNT_DIR -Force
	}
	$Script:fountDir = $env:FOUNT_DIR
}
else {
	$Script:fountDir = (Get-Command fount.ps1).Path | Split-Path -Parent | Split-Path -Parent
}

. "$Script:fountDir/path/fount.ps1" @args
