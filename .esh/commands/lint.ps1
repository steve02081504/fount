eslint $(git diff --name-only;git ls-files --others --exclude-standard) --fix --quiet
eslint $(git diff --name-only;git ls-files --others --exclude-standard) --fix *> $null
typos -w
