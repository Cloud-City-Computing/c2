FROM node:20

WORKDIR /app

# Install deps
COPY package*.json ./
RUN npm install

# Copy rest
COPY . .

EXPOSE 3000

RUN npm run build

CMD ["npm", "run", "start"]