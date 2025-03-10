pkgname=fount
pkgver=0.0.0
pkgrel=1
pkgdesc="A powerful AI character architecture/package loader with a chat UI"
arch=('any')
url="https://github.com/steve02081504/fount"
install=$pkgname.install
makedepends=('git' 'deno')
depends=('git' 'deno') # 运行时依赖，fount 运行需要 deno 和 git

source=("git+https://github.com/steve02081504/fount.git#branch=master")
sha256sums=('SKIP')

pkgver() {
	cd "$srcdir/fount"
	echo "$(git log -1 --pretty=format:"%cd" --date=format:'%Y.%m.%d.%H.%M.%S').git@$(git rev-parse --short HEAD)"
}

package() {
	install -dm755 "${pkgdir}/usr/share/fount"
	install -dm755 "${pkgdir}/usr/bin"

	cp -a "${srcdir}/fount/"* "${pkgdir}/usr/share/fount"
	rm -rf "${pkgdir}/usr/share/fount/data" "${pkgdir}/usr/share/fount/node_modules" "${pkgdir}/usr/share/fount/.git"

	# Create the fount executable script
	echo "#!/usr/bin/env bash

/usr/share/fount/path/fount.sh \"\$@\"
" > "${pkgdir}/usr/bin/fount"
	chmod +x "${pkgdir}/usr/bin/fount"
	# 创建fount.sh以避免fount将自己添加到profile
	cp "${pkgdir}/usr/bin/fount" "${pkgdir}/usr/bin/fount.sh"
	chmod +x "${pkgdir}/usr/bin/fount.sh"

	# var/lib/fount 用于存储数据
	install -dm755 "${pkgdir}/var/lib/fount/data"
	install -dm755 "${pkgdir}/var/lib/fount/node_modules"

	# 软链接
	ln -sf "/var/lib/fount/data" "${pkgdir}/usr/share/fount/data"
	ln -sf "/var/lib/fount/node_modules" "${pkgdir}/usr/share/fount/node_modules"

	touch "${pkgdir}/usr/share/fount/.noupdate"
}
