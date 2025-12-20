#!/bin/bash
set -e

# 1. Get the current Public IP from EC2 Metadata service
#    (This only works inside an EC2 instance)
echo "Fetching Public IP..."
PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)

if [ -z "$PUBLIC_IP" ]; then
    echo "Could not fetch Public IP. Are we running on EC2?"
    exit 1
fi

echo "Found Public IP: $PUBLIC_IP"

# 2. Create the JSON payload for Route 53
#    We use UPSERT to create the record if it doesn't exist, or update it if it does.
cat > /tmp/route53_changes.json <<EOF
{
  "Comment": "Auto-update from Docker Compose",
  "Changes": [
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "$DOMAIN_NAME",
        "Type": "A",
        "TTL": 300,
        "ResourceRecords": [
          {
            "Value": "$PUBLIC_IP"
          }
        ]
      }
    }
  ]
}
EOF

# 3. Execute the update
echo "Updating Route 53 Record ($DOMAIN_NAME)..."
aws route53 change-resource-record-sets \
    --hosted-zone-id "$AWS_HOSTED_ZONE_ID" \
    --change-batch file:///tmp/route53_changes.json

echo "DNS Update Complete!"
