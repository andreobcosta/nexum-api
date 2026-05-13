FROM node:20-slim
WORKDIR /app
COPY backend/package.json ./backend/
RUN cd backend && npm install --production
# LibreOffice headless para converter DOCX → PDF com fidelidade visual
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
COPY backend/ ./backend/
RUN rm -f /app/backend/.env
COPY frontend/ ./frontend/
EXPOSE 8080
CMD ["node", "backend/server.js"]
