FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .

EXPOSE 8787

CMD ["npx", "wrangler", "dev", "--ip", "0.0.0.0", "--port", "8787"]
