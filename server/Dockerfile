FROM node:22-alpine
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY client/ /app/client/
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "npm run migrate && npm run seed && npm start"]
