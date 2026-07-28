# Bobcats skills Makefile
# Builds nested skill sources into a flattened install tree and installs them for AI coding agents.
#
# Run `make install` to build and install.
# If replacing an existing non-managed skill install, run `make install FORCE=1` once.
# Requires Python 3.11+.

PYTHON := python3
BUILD_SCRIPT := $(CURDIR)/scripts/build.py
INSTALL_ARGS :=
ifeq ($(FORCE),1)
INSTALL_ARGS += --force
endif

.PHONY: all help check-python build install install-codex install-skills clean test

all: help

help:
	@echo "bobcats-skills - Skills Installer"
	@echo ""
	@echo "Usage:"
	@echo "  make install            Build and install full skills to all agent roots"
	@echo "  make install-codex      Install Codex-compatible skills to ~/.codex/skills only"
	@echo "  make install FORCE=1    Bootstrap/reset managed install state over collisions"
	@echo "  make install-codex FORCE=1  Bootstrap Codex install state over collisions"
	@echo "  make install-skills     Alias for make install"
	@echo "  make build              Build flattened skills into build/"
	@echo "  make clean              Remove build artifacts"
	@echo "  make test               Run installer tests"
	@echo "  make help               Show this help message"
	@echo ""
	@echo "Install paths:"
	@echo "  Claude Code:           ~/.claude/skills/"
	@echo "  OpenCode/Pi/unified:   ~/.agents/skills/"
	@echo "  Codex:                 ~/.codex/skills/"

check-python:
	@$(PYTHON) -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" 2>/dev/null || \
		(echo "Error: Python 3.11+ required"; exit 1)

build: check-python
	@$(PYTHON) $(BUILD_SCRIPT) build

install: check-python
	@$(PYTHON) $(BUILD_SCRIPT) install $(INSTALL_ARGS)
	@echo "All skills installed"

install-codex: check-python
	@$(PYTHON) $(BUILD_SCRIPT) install --target codex $(INSTALL_ARGS)
	@echo "Codex skills installed"

install-skills: install

clean: check-python
	@$(PYTHON) $(BUILD_SCRIPT) clean

test: check-python
	@$(PYTHON) -m unittest discover -s tests
