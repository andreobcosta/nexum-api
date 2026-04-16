FROM node:20-alpine

WORKDIR /app

# Backend dependencies
COPY backend/package.json backend/
RUN cd backend && npm install --production

# Copy all code
COPY backend/ backend/
COPY frontend/ frontend/

# Create necessary directories
RUN mkdir -p backend/data backend/temp backend/prompts

# Initialize database
RUN cd backend && node db/init.js

EXPOSE 3001

CMD ["node", "backend/server.js"]
