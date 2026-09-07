#!/bin/bash
# Start the family tree server (double-clicking in Finder works too)
cd "$(dirname "$0")"
exec python3 server.py
