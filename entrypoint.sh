#!/bin/bash
# Ensure the directory exists
mkdir -p /usr/src/app/mnt/storage

# Mount GCS bucket using gcsfuse
gcsfuse --implicit-dirs ccm-literature /usr/src/app/mnt/storage

# Start the Node.js application
nexec npm start
