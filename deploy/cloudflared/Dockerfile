FROM cloudflare/cloudflared:2025.11.1 AS cloudflared

FROM alpine:3.22.0
RUN apk add --no-cache ca-certificates curl
COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
ENTRYPOINT ["cloudflared"]
