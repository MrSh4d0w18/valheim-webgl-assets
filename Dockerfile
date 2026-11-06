FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache unzip
COPY package.json ./
COPY tools/serve.mjs ./tools/serve.mjs
COPY v12/part1.bin v12/part2.bin v12/part3.bin /tmp/
RUN mkdir -p public \
 && cat /tmp/part1.bin /tmp/part2.bin /tmp/part3.bin > /tmp/game.zip \
 && unzip -q /tmp/game.zip -d public \
 && rm -f /tmp/part1.bin /tmp/part2.bin /tmp/part3.bin /tmp/game.zip
ENV PORT=8080
EXPOSE 8080
CMD ["node", "tools/serve.mjs"]