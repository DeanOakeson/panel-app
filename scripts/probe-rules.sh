#!/usr/bin/env bash
# Probes the Firestore emulator's security rules. Emulator only. Changes no rules.
# Usage: bash scripts/probe-rules.sh

P=demo-panel-app
FS="http://127.0.0.1:8080/v1/projects/$P/databases/(default)/documents"
AUTH="http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key"

tok() {
  curl -s -X POST "$AUTH" -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"$2\",\"returnSecureToken\":true}" \
    | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).idToken' 2>/dev/null
}

code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

STUDENT=$(tok student@test.com 123456)
ADMIN=$(tok admin@test.com 123456)

if [ -z "$STUDENT" ] || [ "$STUDENT" = "undefined" ]; then
  echo "WARNING: no student token (does student@test.com exist with password 123456?)"
  STUDENT=""
fi
if [ -z "$ADMIN" ] || [ "$ADMIN" = "undefined" ]; then
  echo "WARNING: no admin token (does admin@test.com exist with password 123456?)"
  ADMIN=""
fi

# Seed a probe doc using the emulator's rules-bypassing owner token
curl -s -o /dev/null -X PATCH "$FS/users/rules-probe" -H "Authorization: Bearer owner" \
  -H "Content-Type: application/json" \
  -d '{"fields":{"role":{"stringValue":"student"},"name":{"stringValue":"Probe"}}}'

JSON='Content-Type: application/json'

echo "1 anonymous reads a user doc:     $(code "$FS/users/rules-probe")"
echo "3 anonymous lists all users:      $(code "$FS/users")"
echo "7 anonymous writes a user doc:    $(code -X PATCH "$FS/users/rules-probe?updateMask.fieldPaths=role" -H "$JSON" -d '{"fields":{"role":{"stringValue":"admin"}}}')"

if [ -n "$STUDENT" ]; then
  echo "2 student reads someone else's:   $(code "$FS/users/rules-probe" -H "Authorization: Bearer $STUDENT")"
  echo "4 student writes courses:         $(code -X PATCH "$FS/courses/probe" -H "Authorization: Bearer $STUDENT" -H "$JSON" -d '{"fields":{"name":{"stringValue":"x"}}}')"
  echo "5 student sets probe role=admin:  $(code -X PATCH "$FS/users/rules-probe?updateMask.fieldPaths=role" -H "Authorization: Bearer $STUDENT" -H "$JSON" -d '{"fields":{"role":{"stringValue":"admin"}}}')"
fi
if [ -n "$ADMIN" ]; then
  echo "6 admin reads someone else's:     $(code "$FS/users/rules-probe" -H "Authorization: Bearer $ADMIN")"
fi

# Clean up
curl -s -o /dev/null -X DELETE "$FS/users/rules-probe" -H "Authorization: Bearer owner"
curl -s -o /dev/null -X DELETE "$FS/courses/probe" -H "Authorization: Bearer owner"

echo
echo "200 = allowed, 403 = denied by rules."
EOF
