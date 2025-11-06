#!/usr/bin/env node

const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const { program } = require('commander');
const superagent = require('superagent');

// Налаштування командного рядка
program
  .requiredOption('-h, --host <host>', 'адреса сервера')
  .requiredOption('-p, --port <port>', 'порт сервера')
  .requiredOption('-c, --cache <cache>', 'шлях до директорії для кешованих файлів')
  .parse();

const options = program.opts();

// Створення директорії для кешу, якщо вона не існує
async function ensureCacheDirectory() {
  try {
    await fs.access(options.cache);
  } catch (error) {
    await fs.mkdir(options.cache, { recursive: true });
    console.log(`Створено директорію для кешу: ${options.cache}`);
  }
}

// Функція для отримання шляху до файлу кешу
function getCacheFilePath(httpCode) {
  return path.join(options.cache, `${httpCode}.jpg`);
}

// Функція для читання файлу з кешу
async function readFromCache(httpCode) {
  try {
    const filePath = getCacheFilePath(httpCode);
    const data = await fs.readFile(filePath);
    return data;
  } catch (error) {
    return null;
  }
}

// Функція для запису файлу в кеш
async function writeToCache(httpCode, data) {
  const filePath = getCacheFilePath(httpCode);
  await fs.writeFile(filePath, data);
}

// Функція для видалення файлу з кешу
async function deleteFromCache(httpCode) {
  const filePath = getCacheFilePath(httpCode);
  await fs.unlink(filePath);
}

// Функція для отримання картинки з http.cat
async function fetchFromHttpCat(httpCode) {
  try {
    const response = await superagent.get(`https://http.cat/${httpCode}`);
    return response.body;
  } catch (error) {
    return null;
  }
}

// Створення HTTP сервера
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const httpCode = url.pathname.substring(1); // Видаляємо початковий '/'

  console.log(`${new Date().toISOString()} - ${req.method} ${req.url} from ${req.connection.remoteAddress}`);

  // Обробка кореневого шляху
  if (!httpCode) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <h1>🐱 Кешуючий проксі-сервер для HTTP Cat</h1>
      <p>Використання: <code>GET /{HTTP_CODE}</code></p>
      <p>Приклади:</p>
      <ul>
        <li><a href="/200">GET /200</a> - OK</li>
        <li><a href="/404">GET /404</a> - Not Found</li>
        <li><a href="/500">GET /500</a> - Internal Server Error</li>
      </ul>
      <p>Підтримувані методи: GET, PUT, DELETE</p>
    `);
    return;
  }

  // Перевірка валідності HTTP коду
  if (!/^\d{3}$/.test(httpCode)) {
    console.log(`Invalid HTTP code format: ${httpCode}`);
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Invalid HTTP code format: "${httpCode}". Please use 3-digit HTTP status code (e.g., 200, 404, 500)`);
    return;
  }

  try {
    switch (req.method) {
      case 'GET':
        // Спочатку перевіряємо кеш
        let imageData = await readFromCache(httpCode);
        
        if (!imageData) {
          console.log(`Cache miss for ${httpCode}, fetching from http.cat`);
          // Якщо немає в кеші, запитуємо з http.cat
          imageData = await fetchFromHttpCat(httpCode);
          
          if (!imageData) {
            console.log(`Image not found on http.cat for code ${httpCode}`);
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Image not found');
            return;
          }
          
          // Зберігаємо в кеш
          await writeToCache(httpCode, imageData);
          console.log(`Image for ${httpCode} cached successfully`);
        } else {
          console.log(`Cache hit for ${httpCode}`);
        }
        
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        res.end(imageData);
        break;

      case 'PUT':
        // Читаємо дані з тіла запиту
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', async () => {
          try {
            const imageData = Buffer.concat(chunks);
            await writeToCache(httpCode, imageData);
            res.writeHead(201, { 'Content-Type': 'text/plain' });
            res.end('Image cached successfully');
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error caching image');
          }
        });
        break;

      case 'DELETE':
        try {
          await deleteFromCache(httpCode);
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Image deleted from cache');
        } catch (error) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Image not found in cache');
        }
        break;

      default:
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method not allowed');
    }
  } catch (error) {
    console.error('Server error:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal server error');
  }
});

// Запуск сервера
async function startServer() {
  try {
    await ensureCacheDirectory();
    
    server.listen(options.port, options.host, () => {
      console.log(`Проксі-сервер запущено на http://${options.host}:${options.port}`);
      console.log(`Директорія кешу: ${options.cache}`);
    });
  } catch (error) {
    console.error('Помилка запуску сервера:', error);
    process.exit(1);
  }
}

startServer();
