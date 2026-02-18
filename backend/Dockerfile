# Imagen base ligera
FROM node:20-alpine

# Crear directorio de trabajo
WORKDIR /app

# Copiar package files primero (mejor cache)
COPY package*.json ./

# Instalar dependencias
RUN npm install --omit=dev

# Copiar todo el proyecto
COPY . .

# Crear carpetas necesarias
RUN mkdir -p logs backups data

# Exponer puerto
EXPOSE 3000

# Variables por defecto
ENV NODE_ENV=production

# Comando de inicio
CMD ["node", "index.js"]
