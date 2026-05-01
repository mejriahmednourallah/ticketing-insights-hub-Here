FROM oven/bun:1.1.45

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile || bun install

COPY . .

EXPOSE 8080

CMD ["bun", "run", "dev", "--host", "0.0.0.0", "--port", "8080"]
