#!/bin/bash
# Send a Telegram notification via the Jarvis server.
# Usage: telegram-notify.sh "Your message here"

MESSAGE="${1:-Agent completed}"

curl -s --max-time 5 -X POST "http://localhost:7749/api/notifications/send" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "
import json, sys
print(json.dumps({'title': 'Notification', 'message': sys.argv[1]}))
" "$MESSAGE")" \
  > /dev/null 2>&1 || true
