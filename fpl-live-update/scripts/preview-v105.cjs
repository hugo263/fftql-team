// Static preview with read-only upstreams. No production mutations or analytics.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'../public'),cache=new Map();
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.json':'application/json','.webmanifest':'application/manifest+json'};
http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(204);return res.end();}
    if(url.pathname.startsWith('/api/')) {
      if(url.pathname.includes('stream')){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': local preview\n\n');return;}
      const target=url.pathname.startsWith('/api/news/')?'http://127.0.0.1:4431/api/site/'+url.pathname.slice(10)+url.search:'https://fftql.team'+url.pathname+url.search;
      let data=cache.get(target);
      if(!data){const r=await fetch(target,{signal:AbortSignal.timeout(30000)});data={status:r.status,type:r.headers.get('content-type'),body:Buffer.from(await r.arrayBuffer())};if(r.ok)cache.set(target,data);}
      res.writeHead(data.status,{'Content-Type':data.type||'application/json','Cache-Control':'no-store'});return res.end(data.body);
    }
    let pathname=decodeURIComponent(url.pathname);
    if(pathname==='/')pathname=url.searchParams.has('league')?'/index.html':'/portal.html';
    if(pathname==='/portal')pathname='/portal.html';if(pathname==='/draft/')pathname='/index.html';
    const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep))throw Error('Bad path');
    const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);
  }catch(error){res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:String(error)}));}
}).listen(4430,'127.0.0.1',()=>console.log('v105 preview http://127.0.0.1:4430'));
