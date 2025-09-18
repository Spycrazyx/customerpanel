# Use official Node.js LTS image
FROM node:18

# Create app directory inside container
WORKDIR /app

# Copy package.json and package-lock.json first (for caching)
COPY package*.json ./

# Install dependencies (production only)
RUN npm install --production

# Copy the rest of your app files
COPY . .

# Expose the port your app listens on
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Start your app
CMD ["npm", "start"]
