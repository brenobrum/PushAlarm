FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
# Registered devices live here; mount a volume at /data to keep them across deploys.
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production PORT=3000 DATA_FILE=/data/devices.json
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
