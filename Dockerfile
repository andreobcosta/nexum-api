FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    fonts-liberation \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/package.json ./backend/
RUN cd backend && npm install --production
COPY backend/ ./backend/
RUN rm -f /app/backend/.env
COPY frontend/ ./frontend/
EXPOSE 8080
CMD ["node", "backend/server.js"]
