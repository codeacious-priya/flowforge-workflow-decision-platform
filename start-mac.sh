#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -f backend/.env ]; then cp backend/.env.example backend/.env; echo 'Created backend/.env: verify MONGO_URI before running.'; fi
npm run install:all
printf '\nNext: open two terminals and run:\n  npm run dev:backend\n  npm run dev:frontend\n\nThen visit http://localhost:5173\n'
