FROM node:20-alpine

WORKDIR /app

COPY rent_finder_front/package.json rent_finder_front/package-lock.json ./
RUN npm ci

COPY rent_finder_front/ ./

ARG FRONT_PORT=5000
ENV NODE_ENV=production
ENV PORT=${FRONT_PORT}

RUN npm run build

EXPOSE ${FRONT_PORT}

CMD ["npm", "run", "start"]
