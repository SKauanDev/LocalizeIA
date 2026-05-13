# 1. Usar o Node 22 (mais estável para as versões novas do Playwright)
FROM node:22-slim

# 2. Definir diretório de trabalho
WORKDIR /app

# 3. Instalar dependências básicas do sistema
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    --no-install-recommends

# 4. Copiar arquivos de dependências
COPY package*.json ./

# 5. Instalar as dependências do seu projeto (Express, Playwright, etc)
RUN npm install

# 6. COMANDO ESSENCIAL: Instala o Chromium e todas as bibliotecas que ele precisa
# O flag --with-deps já instala todas aquelas 'libasound', 'libatk', etc. automaticamente
RUN npx playwright install chromium --with-deps

# 7. Copiar o resto do código
COPY . .

# 8. Expor a porta 3000
EXPOSE 3000

# 9. Comando para rodar a aplicação
CMD ["npm", "start"]