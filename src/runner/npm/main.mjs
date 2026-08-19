#!/usr/bin/env node
import process from 'node:process'

import { sh_exec, pwsh_exec, available, where_command, execFile } from '@steve02081504/exec'

/**
 * 调用 fount 命令
 * @returns {Promise<never>} 退出进程
 */
async function call_fount() {
	const { code } = await execFile(await where_command('fount'), process.argv.slice(2), { stdio: 'inherit', no_output_record: true })
	process.exit(code)
}

// 已安装 fount，直接转发参数
if (await where_command('fount')) await call_fount()

if (await available.pwsh) // 走pwsh安装，不用确定bash
	await pwsh_exec(`\
$scriptContent = Invoke-RestMethod https://steve02081504.github.io/fount/install.ps1
Invoke-Expression "function fountInstaller { $scriptContent }"
fountInstaller init
`, { stdio: 'inherit', no_output_record: true })
else if (await available.sh) // 哈哈，nix地狱来喽
	await sh_exec(`\
install_package() { _command_name="$1"; _package_list=\${2:-$_command_name}; _has_sudo=""; _installed_pkg_name="" ; if command -v "$_command_name" >/dev/null 2>&1; then return 0; fi; if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then _has_sudo="sudo"; fi; for _package in $_package_list; do if command -v apt-get >/dev/null 2>&1; then $_has_sudo apt-get update -y; $_has_sudo apt-get install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v pacman >/dev/null 2>&1; then $_has_sudo pacman -Syy --noconfirm; $_has_sudo pacman -S --needed --noconfirm "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v dnf >/dev/null 2>&1; then $_has_sudo dnf install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v yum >/dev/null 2>&1; then $_has_sudo yum install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v zypper >/dev/null 2>&1; then $_has_sudo zypper install -y --no-confirm "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v apk >/dev/null 2>&1; then if [ "$(id -u)" -eq 0 ]; then apk add --update "$_package"; else $_has_sudo apk add --update "$_package"; fi; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v brew >/dev/null 2>&1; then if ! brew list --formula "$_package"; then brew install "$_package"; fi; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v pkg >/dev/null 2>&1; then pkg install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v snap >/dev/null 2>&1; then $_has_sudo snap install "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; done; if command -v "$_command_name" >/dev/null 2>&1; then case ";$FOUNT_AUTO_INSTALLED_PACKAGES;" in *";$_installed_pkg_name;"*) ;; *) if [ -z "$FOUNT_AUTO_INSTALLED_PACKAGES" ]; then FOUNT_AUTO_INSTALLED_PACKAGES="$_installed_pkg_name"; else FOUNT_AUTO_INSTALLED_PACKAGES="$FOUNT_AUTO_INSTALLED_PACKAGES;$_installed_pkg_name"; fi; ;; esac; return 0; else echo "Error: Failed to install '$_command_name' from any source." >&2; return 1; fi; }
install_package "bash" "bash gnu-bash"; install_package "curl"
export FOUNT_AUTO_INSTALLED_PACKAGES
curl -fsSL https://steve02081504.github.io/fount/install.sh | bash -s init
. "$HOME/.profile"
`, { stdio: 'inherit', no_output_record: true })

if (await where_command('fount')) {
	console.log(`\
fount installed successfully.
since npm unable to run command when package uninstalled, you need to run this command to uninstall fount in the future:

fount remove
`)
	await call_fount()
}
else
	console.error(`\
Error: Failed to install fount.
Please install it manually from https://steve02081504.github.io/fount/
`)
process.exit(1)
