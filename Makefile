# Family tree. Run `make` for the list of targets.
#
# The server needs nothing but a Python 3 standard library, so there is no
# install step. Data lives in data/family.db and is never committed.

PYTHON      ?= python3
PORT        ?= 8791
URL         := http://localhost:$(PORT)/
DB          := data/family.db
BACKUP_DIR  ?= backups
TEST_PORT   ?= 8799
TEST_DB     := .test-data/family.db
TREE_DIR    := deploy/tree
TREE_JSON   := $(TREE_DIR)/tree.json

# Where `make deploy` copies the public page. Override on the command line:
#   make deploy DEPLOY_TARGET=user@host:/var/www/tree/
DEPLOY_TARGET ?=

APP_JS := app.js i18n.js chart.js $(TREE_DIR)/tree.js $(TREE_DIR)/i18n.js $(TREE_DIR)/chart.js

.DEFAULT_GOAL := help
.PHONY: help run open db backup export sync deploy-target deploy check test-server test-reset clean

help: ## Show this list
	@echo 'Family tree'
	@echo
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk -F':.*?## ' '{ printf "  \033[1m%-12s\033[0m %s\n", $$1, $$2 }'
	@echo
	@echo '  site   $(URL)'
	@echo '  db     $(DB)'

run: ## Start the local server (Ctrl+C to stop)
	$(PYTHON) server.py

test-server: ## Start a throwaway server on its own port and database
	@echo 'port $(TEST_PORT), database $(TEST_DB), your data/ is not touched'
	FAMILY_TREE_PORT=$(TEST_PORT) FAMILY_TREE_DB=$(TEST_DB) $(PYTHON) server.py

test-reset: ## Delete the throwaway database
	rm -rf .test-data

open: ## Open the site in a browser
	@if command -v xdg-open >/dev/null 2>&1; then xdg-open '$(URL)'; \
	elif command -v open >/dev/null 2>&1; then open '$(URL)'; \
	elif command -v wslview >/dev/null 2>&1; then wslview '$(URL)'; \
	else echo 'Open $(URL) yourself, no browser opener found'; fi

db: ## Open the SQLite database in the sqlite3 shell
	@test -f '$(DB)' || { echo 'No $(DB) yet. Run `make run` and add someone first.'; exit 1; }
	sqlite3 '$(DB)'

backup: ## Copy the database into backups/ with a timestamp
	@test -f '$(DB)' || { echo 'No $(DB) to back up.'; exit 1; }
	@mkdir -p '$(BACKUP_DIR)'
	@out='$(BACKUP_DIR)/family-$(shell date +%Y%m%d-%H%M%S).db'; \
	$(PYTHON) -c "import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()" '$(DB)' "$$out"; \
	echo "$$out"

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

clean: ## Remove build leftovers (never touches data/ or backups/)
	rm -rf __pycache__ .pytest_cache .test-data
	rm -f server.log
