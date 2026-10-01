// Serve the built site under a project path, as GitHub Pages would.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const root=resolve('dist'),prefix='/piano-preview/';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.txt':'text/plain'};
createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith(prefix)){res.writeHead(404);res.end('Use /piano-preview/');return;}const path=resolve(root,decodeURIComponent(url.pathname.slice(prefix.length)||'index.html'));if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}const data=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);}catch{res.writeHead(404);res.end('Not found');}}).listen(4173,'127.0.0.1',()=>console.log('Production Pages-path preview: http://127.0.0.1:4173/piano-preview/'));
