FROM node:26-alpine AS builder

# Refresh base-image OS packages (same reason as apps/api/Dockerfile).
RUN apk upgrade --no-cache

WORKDIR /app

ARG VITE_API_URL=
ARG VITE_GOOGLE_CLIENT_ID=
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
ENV HUSKY=0
RUN npm ci --workspace apps/web --ignore-scripts

COPY apps/web ./apps/web
WORKDIR /app/apps/web
RUN npm run build

# nginx:alpine already drops privileges internally after binding to port 80.
# Using a separate USER directive is not recommended here as nginx needs root
# to bind to privileged ports. Consider nginxinc/nginx-unprivileged if needed.
FROM nginx:alpine
RUN apk upgrade --no-cache && apk add --no-cache curl
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
