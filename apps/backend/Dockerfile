FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

# Install ALL dependencies (including dev for build)
RUN npm ci

COPY . .

# Generate Prisma client + build
RUN npx prisma generate
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

EXPOSE 5001

CMD ["node", "dist/index.js"]
