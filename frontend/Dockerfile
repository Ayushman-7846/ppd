FROM node:24-alpine AS build
WORKDIR /project/frontend
ARG BACKEND_URL=http://backend:8000
ENV BACKEND_URL=$BACKEND_URL NEXT_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1
COPY frontend/package*.json ./
RUN npm ci
COPY frontend .
COPY datasets /project/datasets
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /project/frontend
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /project/frontend/.next/standalone ./
COPY --from=build --chown=node:node /project/frontend/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
