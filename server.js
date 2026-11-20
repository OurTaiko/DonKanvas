import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const types = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.tja': 'application/octet-stream' };
export function mediaMiddleware(directory = path.dirname(root)) {
  return async (request, response, next) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname !== '/api/files' && !url.pathname.startsWith('/media/')) return next();
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
      if (url.pathname === '/api/files') {
        const files = await readdir(directory, { withFileTypes: true });
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
        response.end(request.method === 'HEAD' ? undefined : JSON.stringify(files.filter(file => file.isFile() && /\.(tja|mp3|wav|ogg)$/i.test(file.name)).map(file => file.name)));
        return;
      }
      const filename = path.resolve(directory, decodeURIComponent(url.pathname.slice(7)));
      if (path.dirname(filename) !== directory || !types[path.extname(filename).toLowerCase()]) { response.writeHead(403); response.end(); return; }
      const info = await stat(filename);
      if (!info.isFile()) throw new Error('Not found');
      const body = request.method === 'HEAD' ? undefined : await readFile(filename);
      response.writeHead(200, { 'Content-Type': types[path.extname(filename).toLowerCase()], 'Content-Length': info.size, 'Cache-Control': 'no-cache' });
      response.end(body);
    } catch { response.writeHead(404); response.end('Not found'); }
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { createServer } = await import('vite');
  const server = await createServer({ root });
  await server.listen();
  server.printUrls();
}