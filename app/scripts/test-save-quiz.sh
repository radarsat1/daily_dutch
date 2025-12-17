#!/bin/bash

D=$(dirname $0)
PROJECT_URL=$(grep _URL $D/../.env.local | cut -d= -f2)
ANON_KEY=$(grep ANON_KEY $D/../.env.local | cut -d= -f2)

if [ -z "$TOKEN" ]; then
    echo Need \$TOKEN, run \"export $(scripts/login.sh)\"
    exit 1
fi

curl -i -X POST "${PROJECT_URL}/functions/v1/save-quiz" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "context": {
      "title": "My Manual Test Quiz",
      "url": "https://example.com",
      "type": "article"
    },
    "word_list_ids": [],
    "questions": [
      {
        "question": "De kat zit op de ______.",
        "answer": "mat",
        "english": "The cat is on the mat."
      },
      {
        "question": "Ik drink ______.",
        "answer": "water",
        "english": "I drink water."
      }
    ]
  }'
