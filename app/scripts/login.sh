#!/bin/bash

D=$(dirname $0)
PROJECT_URL=$(grep SUPABASE_URL $D/../.env.local | cut -d= -f2)
ANON_KEY=$(grep ANON_KEY $D/../.env.local | cut -d= -f2)

USER_EMAIL="test@test.com"
USER_PASSWORD="bbbbbbbb"

RESULT=$(curl -s -X POST "${PROJECT_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "'"${USER_EMAIL}"'",
    "password": "'"${USER_PASSWORD}"'"
  }'
       )

echo TOKEN=$(echo $RESULT | jq -r .access_token)
