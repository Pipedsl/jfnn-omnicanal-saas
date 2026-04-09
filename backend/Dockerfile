# ── JFNN Backend — Dockerfile para Railway ──────────────────────
FROM node:20-alpine

WORKDIR /app

# Copia dependencias primero (cache layer)
COPY package*.json ./
RUN npm install --omit=dev

# Copia el resto del código
COPY . .

# Railway inyecta la variable PORT automáticamente
ENV NODE_ENV=production

EXPOSE $PORT

CMD ["node", "index.js"]
