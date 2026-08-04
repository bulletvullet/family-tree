#!/bin/bash
# Запуск сервера семейного древа (двойной клик в Finder тоже работает)
cd "$(dirname "$0")"
exec python3 server.py
