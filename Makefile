# Family tree. Run `make` for the list of targets.
#
# The server needs nothing but a Python 3 standard library, so there is no
# install step. Data lives in data/family.json and is never committed.

PYTHON      ?= python3
PORT        ?= 8791
URL         := http://localhost:$(PORT)/
DATA        := data/family.json
BACKUP_DIR  := data/backups
TEST_PORT   ?= 8799
TEST_DATA   := .test-data/family.json
TREE_DIR    := deploy/tree
TREE_JSON   := $(TREE_DIR)/tree.json

# Where `make deploy` copies the public page. Override on the command line:
#   make deploy DEPLOY_TARGET=user@host:/var/www/tree/
DEPLOY_TARGET ?=

APP_JS := app.js i18n.js chart.js $(TREE_DIR)/tree.js $(TREE_DIR)/i18n.js $(TREE_DIR)/chart.js

.DEFAULT_GOAL := help
.PHONY: help run open backup export sync deploy-target deploy check test test-server test-reset clean

help: ## Show this list
	@echo 'Family tree'
	@echo
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk -F':.*?## ' '{ printf "  \033[1m%-12s\033[0m %s\n", $$1, $$2 }'
	@echo
	@echo '  site   $(URL)'
	@echo '  data   $(DATA)'

run: ## Start the local server (Ctrl+C to stop)
	$(PYTHON) server.py

test-server: ## Start a throwaway server on its own port and data file
	@echo 'port $(TEST_PORT), data $(TEST_DATA), your data/ is not touched'
	FAMILY_TREE_PORT=$(TEST_PORT) FAMILY_TREE_DATA=$(TEST_DATA) $(PYTHON) server.py

test-reset: ## Delete the throwaway data and its backups
	rm -rf .test-data

open: ## Open the site in a browser
	@if command -v xdg-open >/dev/null 2>&1; then xdg-open '$(URL)'; \
	elif command -v open >/dev/null 2>&1; then open '$(URL)'; \
	elif command -v wslview >/dev/null 2>&1; then wslview '$(URL)'; \
	else echo 'Open $(URL) yourself, no browser opener found'; fi

backup: ## Copy the tree into data/backups/ with a timestamp
	@test -f '$(DATA)' || { echo 'No $(DATA) to back up.'; exit 1; }
	@mkdir -p '$(BACKUP_DIR)'
	@out='$(BACKUP_DIR)/family-$(shell date +%Y%m%d-%H%M%S)-manual.json'; \
	cp '$(DATA)' "$$out" && echo "$$out"

export: ## Pull the current tree into deploy/tree/tree.json
	@curl -fsS '$(URL)api/tree' -o '$(TREE_JSON)' \
		&& echo 'wrote $(TREE_JSON)' \
		|| { echo 'Server not answering on $(URL). Start it with `make run`.'; exit 1; }

sync: ## Refresh the shared files the public page keeps its own copy of
	cp i18n.js '$(TREE_DIR)/i18n.js'
	cp chart.js '$(TREE_DIR)/chart.js'
	cp vendor/graph-bundle.js '$(TREE_DIR)/graph-bundle.js'

# Checked before sync and export so a missing destination fails straight away
deploy-target:
	@test -n '$(DEPLOY_TARGET)' || { \
		echo 'Set the destination, for example:'; \
		echo '  make deploy DEPLOY_TARGET=user@host:/var/www/tree/'; exit 1; }

deploy: deploy-target sync export ## Upload the public tree page (needs DEPLOY_TARGET)
	rsync -az --exclude tree.example.json '$(TREE_DIR)/' '$(DEPLOY_TARGET)'

check: ## Syntax-check the Python and JavaScript sources
	$(PYTHON) -m py_compile server.py
	@if command -v node >/dev/null 2>&1; then \
		for f in $(APP_JS); do node --check "$$f" && echo "ok  $$f"; done; \
	else echo 'skip JavaScript check, node is not installed'; fi

test: ## Run the chart layout tests (needs node)
	node --test tests/*.test.mjs

clean: ## Remove build leftovers (never touches data/)
	rm -rf __pycache__ .pytest_cache .test-data
	rm -f server.log
