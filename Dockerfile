FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install -g prisma@5.18.0
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./
COPY --from=builder /app/prisma ./prisma
# npm ci --omit=dev runs before prisma/ is copied in, so @prisma/client's
# own postinstall generate step can't find the schema and produces nothing —
# node_modules/.prisma/client ends up empty, which is the "did not initialize
# yet" error at runtime. Generate explicitly, now that the schema is present.
RUN prisma generate
RUN mkdir -p /app/uploads
EXPOSE 3000
CMD ["sh", "-c", "prisma migrate deploy && npm start"]
