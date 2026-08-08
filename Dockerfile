FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server.mjs ./
COPY public ./public
COPY data ./data
ENV NODE_ENV=production
EXPOSE 3888
CMD ["node", "server.mjs"]
