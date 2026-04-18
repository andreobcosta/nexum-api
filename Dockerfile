FROM node:20-slim
WORKDIR /app
COPY backend/package.json ./backend/
RUN cd backend && npm install --production
COPY backend/ ./backend/
COPY frontend/ ./frontend/
EXPOSE 8080
ENV PORT=8080
CMD ["node", "backend/server.js"]
