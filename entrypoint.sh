#!/bin/bash
# Mount GCS bucket using gcsfuse
gcsfuse ccm-literature mnt/storage

# Start the Node.js application
node index_1.js
