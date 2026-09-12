const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
http.createServer(async (req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  if (['/api/inventory','/api/events'].includes(pathname)) {
    res.status = code => { res.statusCode=code; return res; };
    res.json = body => { res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));return res; };
    if (req.method==='POST') {
      let body='';for await (const chunk of req) {body+=chunk;if(body.length>100000){res.status(413).json({error:'Request too large'});return;}}
      try{req.body=JSON.parse(body);}catch{res.status(400).json({error:'Invalid JSON'});return;}
    }
    return require('../api/'+pathname.split('/').pop()+'.js')(req,res);
  }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep) || !['index.html', 'js', 'css'].includes(path.relative(root, file).split(path.sep)[0])) { res.writeHead(404).end(); return; }
  fs.readFile(file, (error, data) => { if (error) { res.writeHead(404).end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data); });
}).listen(5500, '127.0.0.1', () => console.log('Inventory preview: http://127.0.0.1:5500'));
