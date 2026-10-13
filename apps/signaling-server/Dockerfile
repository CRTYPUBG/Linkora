FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
COPY packages/ packages/
COPY apps/signaling-server/ apps/signaling-server/

RUN npm install
RUN npm --workspace=packages/shared run build
RUN npm --workspace=apps/signaling-server run build

FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache curl

COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/shared/dist ./packages/shared/dist
COPY apps/signaling-server/package*.json ./apps/signaling-server/
COPY apps/signaling-server/dist ./apps/signaling-server/dist

RUN npm install --omit=dev

EXPOSE 4000
CMD ["npm", "--workspace=apps/signaling-server", "start"]
