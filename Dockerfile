FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY tools/serve.mjs ./tools/serve.mjs
COPY v12/part1.bin v12/part2.bin v12/part3.bin ./v12/
COPY public ./public
ENV PORT=8080
EXPOSE 8080
CMD ["node", "tools/serve.mjs"]