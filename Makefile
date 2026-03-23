.PHONY: install help uninstall run

ARGS ?=

.DEFAULT_GOAL := help

help:
	@echo "make install  initialize fount (equivalent to ./run.sh init)"
	@echo "make uninstall  uninstall fount (equivalent to ./run.sh remove)"
	@echo "make run  run fount (equivalent to ./run.sh)"

install:
ifeq ($(OS),Windows_NT)
	@cmd /c run.bat init
else
	@./run.sh init
endif

uninstall:
ifeq ($(OS),Windows_NT)
	@cmd /c run.bat remove
else
	@./run.sh remove
endif

run:
ifeq ($(OS),Windows_NT)
	@cmd /c run.bat $(ARGS)
else
	@./run.sh $(ARGS)
endif
