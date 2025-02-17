# fount 软件答辩清理指南

本指南旨在帮助用户彻底清除 fount 脚本软件在不同操作系统中安装和运行时产生的文件和配置残留，确保系统干净。

## 1. 文件答辩清单

fount 脚本在不同操作系统中可能产生以下答辩：

**通用答辩 (Windows, Linux, macOS):**

* **安装目录:**
  * **Windows:**  `%LOCALAPPDATA%\fount` (通常展开为 `C:\Users\<用户名>\AppData\Local\fount`) 或用户自定义的 `$env:FOUNT_DIR` 环境变量指定的路径。
  * **Linux/macOS:** `$HOME/.local/share/fount` (通常展开为 `/home/<用户名>/.local/share/fount`) 或用户自定义的 `$FOUNT_DIR` 环境变量指定的路径。
  * **内容:**  包含 fount 软件的源代码、`node_modules` (npm 依赖包目录) 等文件。
* **PATH 环境变量修改:**
  * **目的:**  将 fount 的 `path` 目录添加到系统 `PATH` 环境变量中，以便在命令行中直接运行 `fount` 命令。
  * **位置:**
    * **Windows:** 用户环境变量 `PATH`。
    * **Linux/macOS:**  用户配置文件 (`.bashrc`, `.zshrc` 等) 和当前 shell 会话的 `PATH` 变量。
* **Deno 依赖包:**
  * **位置:**  安装目录下的 `node_modules` 目录。
  * **内容:**  使用 Deno 的 npm 兼容层安装的 JavaScript 依赖包。

**Windows 独有答辩:**

* **Windows Terminal Profile:**
  * **位置:**  `%LOCALAPPDATA%\Microsoft\Windows Terminal\Fragments\fount\fount.json` (通常展开为 `C:\Users\<用户名>\AppData\Local\Microsoft\Windows Terminal\Fragments\fount\fount.json`)
  * **目的:**  在 Windows Terminal 中创建一个名为 "fount" 的配置文件，方便用户通过 Windows Terminal 启动 fount。
* **PowerShell Profile 修改:**
  * **位置:**  用户 PowerShell 配置文件 (`$Profile` 变量指向的文件，通常是 `Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1` 或 `Documents\PowerShell\profile.ps1`)。
  * **目的:**  在 PowerShell 启动时自动导入 `fount-pwsh` 模块，以便在 PowerShell 中使用 fount 相关的 PowerShell 命令。
* **后台程序可执行文件 (如果使用 `background` 参数):**
  * **位置:**  `%TEMP%\fount-background.exe` (通常展开为 `C:\Users\<用户名>\AppData\Local\Temp\fount-background.exe`)
  * **目的:**  用于在后台运行 fount 更新模块的程序。
* **自生成可执行文件 (如果使用 `geneexe` 参数):**
  * **位置:**  用户执行 `geneexe` 命令时指定的路径，默认为当前目录下的 `fount.exe`。
  * **目的:**  将 fount 打包成一个独立的 Windows 可执行文件。
* **PowerShell 模块 (CurrentUser 作用域):**
  * **模块名称:** `ps12exe`, `fount-pwsh`
  * **目的:**  `ps12exe` 用于将 PowerShell 脚本转换为可执行文件，`fount-pwsh` 是 fount 提供的 PowerShell 模块。

**Linux/macOS 独有答辩 (Termux 环境):**

* **Termux 特殊处理安装的软件包:**  在 Termux 环境下，脚本会安装 `pacman`, `patchelf`, `which`, `time`, `ldd`, `tree`, `glibc-runner` 等软件包。这些软件包是 Deno 在 Termux 环境下运行所需的依赖。
* **Deno.js Termux Patch 和 Wrapper 脚本:**  为了在 Termux 上兼容 glibc，脚本会 patch Deno 可执行文件，并创建 `deno.glibc.sh` 包装脚本。

## 2. 清理步骤

请根据您的操作系统，按照以下步骤清除 fount 的答辩。

**通用清理步骤 (Windows, Linux, macOS):**

1. **卸载 fount 软件目录:**
    * **Windows:** 删除 `%LOCALAPPDATA%\fount` 目录 (或 `$env:FOUNT_DIR` 指定的目录)。
    * **Linux/macOS:** 删除 `$HOME/.local/share/fount` 目录 (或 `$FOUNT_DIR` 指定的目录)。
    * **手动删除或使用脚本:** 可以手动在文件管理器中删除，也可以使用下方提供的清理脚本。

2. **移除 PATH 环境变量修改:**
    * **Windows:**
        1. 打开 "系统属性" -> "高级" -> "环境变量"。
        2. 在 "用户变量" 或 "系统变量" 中找到 `Path` 变量，点击 "编辑"。
        3. 检查列表中是否包含 fount 的 `path` 目录 (例如 `%LOCALAPPDATA%\fount\path`)，如果存在则删除该项。
        4. 点击 "确定" 保存修改。
    * **Linux/macOS:**
        1. 打开用户配置文件 (`.bashrc`, `.zshrc` 或其他 shell 配置文件)。
        2. 查找包含 `export PATH="\$PATH:<fount_安装目录>/path"` 的行，删除该行。
        3. 保存文件并关闭。
        4. 重新加载 shell 配置文件 (例如运行 `source ~/.bashrc` 或 `source ~/.zshrc`) 或重启终端，使环境变量修改生效。

3. **删除 Deno 依赖包:**
    * 删除 fount 安装目录下的 `node_modules` 目录。

**Windows 独有清理步骤:**

1. **删除 Windows Terminal Profile:**
    * 删除 `%LOCALAPPDATA%\Microsoft\Windows Terminal\Fragments\fount\fount.json` 文件。

2. **移除 PowerShell Profile 修改:**
    * 打开 PowerShell 配置文件 (`$Profile` 变量指向的文件)。
    * 查找并删除包含 `Import-Module fount-pwsh` 的行。
    * 保存文件并关闭。

3. **删除后台程序可执行文件:**
    * 删除 `%TEMP%\fount-background.exe` 文件。

4. **删除自生成可执行文件:**
    * 删除您在使用 `geneexe` 命令时生成的 `fount.exe` 文件 (如果您生成过)。

5. **卸载 PowerShell 模块:**
    * 打开 PowerShell 终端。
    * 运行以下命令卸载模块：

      ```powershell
      Uninstall-Module -Name ps12exe -Scope CurrentUser -Force
      Uninstall-Module -Name fount-pwsh -Scope CurrentUser -Force
      ```

**Linux/macOS 独有清理步骤 (Termux 环境):**

1. **卸载 Termux 特殊处理安装的软件包:**
    * 打开 Termux 终端。
    * 运行以下命令卸载软件包 (根据实际安装的软件包列表调整)：

      ```bash
      pkg uninstall pacman patchelf which time ldd tree glibc-runner
      ```

2. **删除 Deno.js Termux Patch 和 Wrapper 脚本:**
    * 删除 `~/.deno/bin/deno.glibc.sh` 和 `~/.deno/bin/deno.orig` (如果有)。
    * 如果需要，可以考虑卸载 Deno (Termux 下通常是通过 `curl ... | sh` 安装的，卸载可能需要手动删除 Deno 安装目录，具体卸载方法请参考 Deno 官方文档或 Termux 相关文档)。

## 3. 清理脚本

为了方便用户快速清理 fount 答辩，我们提供了以下清理脚本。请根据您的操作系统选择对应的脚本运行。

**Windows 清理脚本 (PowerShell):**

```powershell
#!pwsh

# 获取 fount 安装目录 (优先使用环境变量，否则使用默认路径)
$FountDir = $env:FOUNT_DIR -NonEmptyString -or "$env:LOCALAPPDATA\fount"

# 卸载 fount 软件目录
if (Test-Path -Path $FountDir -PathType Container) {
    Write-Host "删除 fount 安装目录: '$FountDir'"
    Remove-Item -Path $FountDir -Recurse -Force -Confirm:$false
} else {
    Write-Host "fount 安装目录 '{$FountDir}' 未找到，跳过删除。"
}

# 移除 PATH 环境变量修改
$CurrentPath = [System.Environment]::GetEnvironmentVariable('PATH', 'User')
$FountPathDir = Join-Path $FountDir "path"
if ($CurrentPath -like "*$FountPathDir*") {
    Write-Host "移除 PATH 环境变量中的 fount 路径: '$FountPathDir'"
    $NewPath = $CurrentPath -replace ";?$([regex]::Escape($FountPathDir));?", ';' -replace "^;+|;+$", ''
    [System.Environment]::SetEnvironmentVariable('PATH', $NewPath, 'User')
} else {
    Write-Host "PATH 环境变量中未找到 fount 路径，跳过修改。"
}

# 删除 Windows Terminal Profile
$WTProfilePath = "$env:LOCALAPPDATA\Microsoft\Windows Terminal\Fragments\fount\fount.json"
if (Test-Path -Path $WTProfilePath -PathType Leaf) {
    Write-Host "删除 Windows Terminal Profile: '$WTProfilePath'"
    Remove-Item -Path $WTProfilePath -Force -Confirm:$false
} else {
    Write-Host "Windows Terminal Profile '{$WTProfilePath}' 未找到，跳过删除。"
}

# 移除 PowerShell Profile 修改
$ProfilePath = $Profile
if (Test-Path -Path $ProfilePath -PathType Leaf) {
    $ProfileContent = Get-Content $ProfilePath -ErrorAction Ignore
    if ($ProfileContent -match 'Import-Module fount-pwsh') {
        Write-Host "移除 PowerShell Profile 中的 'Import-Module fount-pwsh' 行"
        $NewProfileContent = $ProfileContent -replace '(?smi)^.*?Import-Module fount-pwsh.*?(\r?\n)?', ''
        Set-Content -Path $ProfilePath -Value $NewProfileContent -Force
    } else {
        Write-Host "PowerShell Profile 中未找到 'Import-Module fount-pwsh' 行，跳过修改。"
    }
} else {
    Write-Host "PowerShell Profile '{$ProfilePath}' 未找到，跳过修改。"
}

# 删除后台程序可执行文件
$BackgroundExePath = Join-Path $env:TEMP "fount-background.exe"
if (Test-Path -Path $BackgroundExePath -PathType Leaf) {
    Write-Host "删除后台程序可执行文件: '$BackgroundExePath'"
    Remove-Item -Path $BackgroundExePath -Force -Confirm:$false
} else {
    Write-Host "后台程序可执行文件 '{$BackgroundExePath}' 未找到，跳过删除。"
}

# 卸载 PowerShell 模块
Write-Host "卸载 PowerShell 模块 'ps12exe' 和 'fount-pwsh'"
try { Uninstall-Module -Name ps12exe -Scope CurrentUser -Force -ErrorAction Stop } catch {}
try { Uninstall-Module -Name fount-pwsh -Scope CurrentUser -Force -ErrorAction Stop } catch {}

Write-Host "fount 答辩清理完成。"
```

**Linux/macOS 清理脚本 (Bash):**

```bash
#!/bin/bash

# 获取 fount 安装目录 (优先使用环境变量，否则使用默认路径)
FOUNT_DIR="${FOUNT_DIR:-"$HOME/.local/share/fount"}"

# 卸载 fount 软件目录
if [ -d "$FOUNT_DIR" ]; then
    echo "删除 fount 安装目录: '$FOUNT_DIR'"
    rm -rf "$FOUNT_DIR"
else
    echo "fount 安装目录 '$FOUNT_DIR' 未找到，跳过删除。"
fi

# 移除 PATH 环境变量修改
PROFILE_FILE=""
if [ -f "$HOME/.bashrc" ]; then
    PROFILE_FILE="$HOME/.bashrc"
elif [ -f "$HOME/.zshrc" ]; then
    PROFILE_FILE="$HOME/.zshrc"
fi

if [ -n "$PROFILE_FILE" ]; then
    if grep -q "export PATH=.*:$FOUNT_DIR/path" "$PROFILE_FILE"; then
        echo "移除 PATH 环境变量中的 fount 路径 (在 '$PROFILE_FILE' 中)"
        sed -i "/export PATH=.*:$FOUNT_DIR\/path/d" "$PROFILE_FILE"
    else
        echo "PATH 环境变量中未在 '$PROFILE_FILE' 找到 fount 路径，跳过修改。"
    fi
else
    echo "未找到 shell 配置文件 (.bashrc 或 .zshrc)，请手动检查 PATH 环境变量。"
fi

# Termux 环境特殊清理 (软件包卸载)
if [[ -d "/data/data/com.termux" ]]; then
    echo "检测到 Termux 环境，尝试卸载特殊安装的软件包..."
    pkg uninstall pacman patchelf which time ldd tree glibc-runner || true
fi

# 删除 Deno.js Termux Patch 和 Wrapper 脚本 (Termux 环境)
if [[ -d "/data/data/com.termux" ]]; then
    rm -f ~/.deno/bin/deno.glibc.sh ~/.deno/bin/deno.orig || true
fi

echo "fount 答辩清理完成。"
```

**使用清理脚本:**

1. **保存脚本:** 将对应操作系统的清理脚本代码保存为文件，例如 `uninstall_fount.ps1` (Windows) 或 `uninstall_fount.sh` (Linux/macOS)。
2. **运行脚本:**
    * **Windows:**  以管理员身份打开 PowerShell 终端，导航到脚本所在目录，运行 `.\uninstall_fount.ps1`。
    * **Linux/macOS:** 打开终端，导航到脚本所在目录，运行 `bash uninstall_fount.sh` (如果脚本文件没有执行权限，先运行 `chmod +x uninstall_fount.sh`)。

**注意事项:**

* **管理员权限:**  Windows 清理脚本可能需要管理员权限才能完全删除所有答辩，特别是修改系统环境变量时。Linux/macOS 脚本通常在用户权限下即可运行。
* **自定义安装路径:** 如果您在安装 fount 时使用了自定义的 `$FOUNT_DIR` 环境变量，请确保在运行清理脚本前设置相同的环境变量，或者手动修改脚本中的默认路径。
* **手动检查:**  清理脚本并非万能，某些情况下可能无法完全清理干净。建议在运行脚本后，手动检查答辩清单中的位置，确保所有文件和配置都被删除。
* **数据备份:**  在运行清理脚本前，建议备份重要数据，以防误操作导致数据丢失。

希望这份详细的清理指南和脚本能够帮助您彻底清除 fount 软件的答辩，保持系统干净整洁。
