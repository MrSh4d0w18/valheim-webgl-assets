FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY tools/serve.mjs ./tools/serve.mjs
COPY tools/versioned-player.mjs ./tools/versioned-player.mjs
COPY tools/native-media.mjs ./tools/native-media.mjs
COPY public ./public
COPY versions ./versions
ENV NATIVE_MEDIA_ROOT=/data/native-media
ENV PORT=8080
EXPOSE 8080
CMD ["node", "tools/serve.mjs"]