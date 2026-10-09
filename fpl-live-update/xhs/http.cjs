'use strict';
const fs=require('node:fs');const path=require('node:path');
const {Store}=require('./store.cjs');const {Problem,fail,zonedLocal}=require('./domain.cjs');
const {manualReceipt}=require('./worker.cjs');
const PREFIX='/api/admin/xhs';
function reply(res,status,body,type='application/json; charset=utf-8'){
 res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'self'; img-src 'self' blob:; media-src 'self' blob:; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
 res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));
}
async function read(req,max){
 const chunks=[];let n=0;
 for await(const chunk of req){n+=chunk.length;if(n>max)fail('UPLOAD_TOO_LARGE',413);chunks.push(chunk);}
 return Buffer.concat(chunks);
}
function createHandler({isAdmin,dir,enabled=false,allowMock=false,origin,rulesFile}){
 let store;
 return async(req,res,url)=>{
  const p=url.pathname;
  if(p!=='/admin/xhs'&&!p.startsWith(PREFIX+'/')&&p!==PREFIX)return false;
  try{
   if(!enabled){reply(res,404,{error:'MODULE_DISABLED'});return true;}
   if(!isAdmin(req)){if(p==='/admin/xhs'){res.writeHead(303,{Location:'/admin','Cache-Control':'no-store'});res.end();}else reply(res,401,{error:'AUTH_REQUIRED'});return true;}
   const write=!['GET','HEAD'].includes(req.method);
   if(write&&(req.headers.origin!==origin||req.headers['x-xhs-request']!=='1'||req.headers['sec-fetch-site']==='cross-site'))fail('CSRF_REJECTED',403);
   if(req.method!=='GET'&&req.method!=='POST')fail('METHOD_NOT_ALLOWED',405);
   if(p==='/admin/xhs'){
    if(write)fail('METHOD_NOT_ALLOWED',405);
    reply(res,200,fs.readFileSync(path.join(__dirname,'ui.html')),'text/html; charset=utf-8');return true;
   }
   const asset=p.match(/^\/api\/admin\/xhs\/assets\/([a-f0-9-]{36})$/);
   if(p===PREFIX+'/ui.js'||p===PREFIX+'/ui.css'){
    if(write)fail('METHOD_NOT_ALLOWED',405);
    const ext=p.endsWith('.js')?'js':'css';reply(res,200,fs.readFileSync(path.join(__dirname,'ui.'+ext)),ext==='js'?'text/javascript; charset=utf-8':'text/css; charset=utf-8');return true;
   }
   store ||= new Store(dir,{allowMock,rulesFile});
   if(asset&&!write){
    const a=store.get('SELECT * FROM xhs_assets WHERE id=?',asset[1]);if(!a)fail('ASSET_NOT_FOUND',404);
    const file=store.assetFile(asset[1]);let data;try{data=fs.readFileSync(file);}catch{fail('ASSET_MISSING',404);}
    const range=req.headers.range;
    if(range&&a.mime==='video/mp4'){
     const m=range.match(/^bytes=(\d+)-(\d*)$/);if(!m)fail('INVALID_RANGE',416);
     const start=Number(m[1]),end=m[2]?Number(m[2]):data.length-1;
     if(start>end||end>=data.length)fail('INVALID_RANGE',416);
     res.writeHead(206,{'Content-Type':a.mime,'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Content-Range':`bytes ${start}-${end}/${data.length}`,'Content-Length':end-start+1,'Accept-Ranges':'bytes'});res.end(data.subarray(start,end+1));
    }else reply(res,200,data,a.mime);return true;
   }
   if(p===PREFIX+'/assets'&&write){reply(res,201,store.addAsset(await read(req,64*1024*1024),String(req.headers['content-type'])));return true;}
   let body={};if(write){if(req.headers['content-type']!=='application/json')fail('JSON_REQUIRED',415);try{body=JSON.parse((await read(req,128*1024)).toString('utf8'));}catch(e){if(e instanceof Problem)throw e;fail('INVALID_JSON');}}
   let value;
   if(p===PREFIX&&!write)value={contents:store.list(),accounts:store.all('SELECT * FROM xhs_accounts'),assets:store.all('SELECT * FROM xhs_assets ORDER BY created_at DESC LIMIT 500'),allowMock,
    capability:{verified:false,mode:'manual',rules:null,checkedAt:null,notice:'账号图文/视频定时、时间窗口、数量格式限制与结果查询均待验证。人工辅助不等于自动发布。'}};
   else if(p===PREFIX+'/accounts'&&write)value=store.account(body);
   else if(p===PREFIX+'/contents'&&write)value=store.save(body.payload);
   else if(p===PREFIX+'/time'&&write)value={utc:zonedLocal(body.localTime,body.timezone)};
   else {
    const m=p.match(/^\/api\/admin\/xhs\/contents\/([a-f0-9-]{36})(?:\/(review|approve|cancel|changed|receipt))?$/);if(!m)fail('NOT_FOUND',404);
    if(!write&&!m[2])value=store.detail(m[1]);
    else if(write){switch(m[2]){
     case undefined:value=store.save(body.payload,m[1],body.version);break;
     case 'review':value=store.requestReview(m[1],body.version);break;
     case 'approve':value=store.approve(m[1],body);break;
     case 'cancel':value=store.cancel(m[1]);break;
     case 'changed':value=store.flagChanged(m[1]);break;
     case 'receipt':value=manualReceipt(store,m[1],body);break;
    }}else fail('METHOD_NOT_ALLOWED',405);
   }
   reply(res,200,value);
  }catch(e){reply(res,e instanceof Problem?e.status:500,{error:e instanceof Problem?e.code:'INTERNAL_ERROR'});}
  return true;
 };
}
module.exports={createHandler};
