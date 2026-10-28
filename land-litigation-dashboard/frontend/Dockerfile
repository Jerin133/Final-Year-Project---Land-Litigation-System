# Stage 1: Build Vite React App
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Pass build args if needed (default from .env or docker-compose)
ARG VITE_CASE_API
ARG VITE_LAND_API
ARG VITE_GIS_API
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY

RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
