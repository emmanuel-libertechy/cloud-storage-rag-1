# Use a Node.js base image
FROM  node:22-bullseye

ARG LOGGING=CLOUD_LOGGING_ONLY


# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Install gcsfuse
RUN apt-get update && apt-get install -y gcsfuse

# Add the entrypoint script
COPY entrypoint.sh /usr/src/app/entrypoint.sh
RUN chmod +x /usr/src/app/entrypoint.sh

# Expose the port the app runs on
EXPOSE 8080

# Set entrypoint to the script
ENTRYPOINT ["/usr/src/app/entrypoint.sh"]