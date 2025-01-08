#!/bin/bash

# Check if GCS bucket is specified
if [ -z "$GCS_BUCKET_NAME" ]; then
  echo "Error: GCS_BUCKET_NAME environment variable is not set."
  exit 1
fi

# Ensure the mount directory exists
mkdir -p mnt/storage

# Mount the GCS bucket using gcsfuse
echo "Mounting GCS bucket: $GCS_BUCKET_NAME"
gcsfuse $GCS_BUCKET_NAME mnt/storage

# Start the Node.js application
echo "Starting the Node.js application..."
exec node index_1.js
