const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = '/tmp/leafcheck-v6-evaluation-web';
http.createServer((req, res) => {
  let file = path.join(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(root + '/') && file !== root) return res.writeHead(403).end();
  try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); }
  catch { file += '.html'; }
  try {
    const data = fs.readFileSync(file);
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.html') ? 'text/html' : file.endsWith('.png') ? 'image/png' : 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404).end(); }
}).listen(8097, '127.0.0.1', () => console.log('Evaluation preview ready on 8097'));
