#!/usr/bin/env fish

# 若是 Windows 环境，则使用 fount.ps1
if test "$OSTYPE" = "msys"
    powerShell.exe -noprofile -executionpolicy bypass -command "{
    \$env:FOUNT_DIR = '$FOUNT_DIR' # 空字符串也是假 所以不需要空判断
    irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
    }" $argv
    exit $status
end

function install_package
    if type -q pkg
        pkg install -y $argv
    else if type -q apt-get
        if type -q sudo
            sudo apt-get update
            sudo apt-get install -y $argv
        else
            apt-get update
            apt-get install -y $argv
        end
    else if type -q brew
        brew install $argv
    else if type -q pacman
        if type -q sudo
            sudo pacman -Syy
            sudo pacman -S --needed --noconfirm $argv
        else
            pacman -Syy
            pacman -S --needed --noconfirm $argv
        end
    else if type -q dnf
        if type -q sudo
            sudo dnf install -y $argv
        else
            dnf install -y $argv
        end
    else if type -q zypper
        if type -q sudo
            sudo zypper install -y --no-confirm $argv
        else
            zypper install -y --no-confirm $argv
        end
    else if type -q apk
        apk add --update $argv
    else
        echo "无法安装 $argv"
        exit 1
    end
end

# 检查依赖
if not type -q git
    install_package git
end
if not type -q unzip
    install_package unzip
end
if not type -q wget
    install_package wget
end

# 若未定义，则默认 fount 安装目录
set FOUNT_DIR (or $FOUNT_DIR "$HOME/.local/share/fount")

# 检查 fount.sh 是否已存在
if not type -q fount.sh
    # 清理旧的 fount 安装（如果存在）
    rm -rf $FOUNT_DIR

    # 尝试使用 git 克隆
    if type -q git
        git clone https://github.com/steve02081504/fount $FOUNT_DIR --depth 1
        if test $status -ne 0
            echo "下载错误，终止脚本" >&2
            exit 1
        end
    else
        # 使用 wget 和 unzip 下载
        rm -rf /tmp/fount-master
        wget -O /tmp/fount.zip https://github.com/steve02081504/fount/archive/refs/heads/master.zip
        if test $status -ne 0
            echo "下载错误，终止脚本" >&2
            exit 1
        end
        unzip -o /tmp/fount.zip -d /tmp
        if test $status -ne 0
            echo "解压错误，可能需要安装 unzip , 可以尝试执行：sudo apt-get install unzip" >&2
            exit 1
        end
        rm /tmp/fount.zip
        # 保证父目录存在
        mkdir -p $FOUNT_DIR
        mv /tmp/fount-master $FOUNT_DIR
    end
    # 移除隔离属性 (仅限 macOS)
    if test "$OSTYPE" = "darwin"*
        xattr -dr com.apple.quarantine $FOUNT_DIR
    end
    find $FOUNT_DIR -name "*.sh" -exec chmod +x {} \;
    find $FOUNT_DIR/path -type f -exec chmod +x {} \;
else
    # fount.sh 已存在，获取其所在目录
    set FOUNT_DIR (dirname (dirname (command -v fount.sh))))
end

# 执行 fount.fish 脚本
$FOUNT_DIR/path/fount.fish $argv
