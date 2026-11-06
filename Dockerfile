FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache curl unzip
COPY package.json ./
COPY tools/serve.mjs ./tools/serve.mjs
RUN mkdir -p public \
 && curl -fL --retry 5 --retry-delay 3 -o /tmp/p1 https://raw.githubusercontent.com/MrSh4d0w18/valheim-webgl-assets/main/v12/part1.bin \
 && curl -fL --retry 5 --retry-delay 3 -o /tmp/p2 https://raw.githubusercontent.com/MrSh4d0w18/valheim-webgl-assets/main/v12/part2.bin \
 && curl -fL --retry 5 --retry-delay 3 -o /tmp/p3 https://raw.githubusercontent.com/MrSh4d0w18/valheim-webgl-assets/main/v12/part3.bin \
 && cat /tmp/p1 /tmp/p2 /tmp/p3 > /tmp/game.zip \
 && unzip -q /tmp/game.zip -d public \
 && rm -f /tmp/p1 /tmp/p2 /tmp/p3 /tmp/game.zip
ENV PORT=8080
EXPOSE 8080
CMD ["node", "tools/serve.mjs"]
