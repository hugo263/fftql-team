'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{Readable}=require('node:stream');
const {createHandler}=require('../http.cjs');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xhs-http-test-'));
 const handler=createHandler({isAdmin:r=>r.headers.cookie==='test-admin',dir,enabled:true,allowMock:true,origin:'https://fftql.team'});
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 async function request(p,{method='GET',body,cookie='test-admin',origin='https://fftql.team',headers={}}={}){
  const req=Readable.from(body===undefined?[]:[Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body))]);req.method=method;req.headers={cookie,origin,'content-type':'application/json','x-xhs-request':'1',...headers};
  let code,head,bytes;const res={writeHead(c,h){code=c;head=h;},end(b){bytes=b;}};
  await handler(req,res,new URL(p,'https://fftql.team'));return {code,headers:head,raw:bytes,json:typeof bytes==='string'&&bytes[0]==='{'?JSON.parse(bytes):null};
 }
 return {request,dir};
}
test('所有后台 API、页面和静态代码拒绝未登录访问',async t=>{const f=fixture(t);for(const p of ['/api/admin/xhs','/api/admin/xhs/ui.js','/api/admin/xhs/ui.css','/api/admin/xhs/assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'])assert.equal((await f.request(p,{cookie:''})).code,401);assert.equal((await f.request('/admin/xhs',{cookie:''})).code,303);});
test('POST 需要精确同源和自定义头，拒绝跨源/伪造',async t=>{const f=fixture(t);for(const opts of [{origin:'https://evil.test'},{headers:{'x-xhs-request':''}},{headers:{'sec-fetch-site':'cross-site'}}])assert.equal((await f.request('/api/admin/xhs/accounts',{method:'POST',body:{label:'测试'},...opts})).code,403);});
test('草稿私有且响应禁止缓存/嵌入，密码字段拒绝',async t=>{const f=fixture(t);const r=await f.request('/api/admin/xhs');assert.equal(r.code,200);assert.match(r.headers['Cache-Control'],/no-store/);assert.equal(r.headers['X-Frame-Options'],'DENY');assert.equal((await f.request('/api/admin/xhs/accounts',{method:'POST',body:{label:'test',password:'secret'}})).code,400);});
test('真实 API CRUD、私有素材、完整批准绑定',async t=>{const f=fixture(t),req=f.request;
 const a=(await req('/api/admin/xhs/accounts',{method:'POST',body:{label:'合成账号',mode:'manual'}})).json;
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l3sAAAAASUVORK5CYII=','base64');
 const asset=(await req('/api/admin/xhs/assets',{method:'POST',body:png,headers:{'content-type':'image/png'}})).json;
 const unauth=await req('/api/admin/xhs/assets/'+asset.id,{cookie:''});assert.equal(unauth.code,401);
 const data=await req('/api/admin/xhs/assets/'+asset.id);assert.deepEqual(data.raw,png);
 const p={title:'test',body:'<script>secret</script>',type:'image',accountId:a.id,images:[asset.id],cover:asset.id,timezone:'Asia/Shanghai',localTime:'2027-01-01T09:00',expiresAt:'2027-01-02T00:00:00Z',isFpl:false};
 let c=(await req('/api/admin/xhs/contents',{method:'POST',body:{payload:p}})).json;assert.equal(c.state,'draft');
 c=(await req('/api/admin/xhs/contents/'+c.id+'/review',{method:'POST',body:{version:1}})).json;
 c=(await req('/api/admin/xhs/contents/'+c.id+'/approve',{method:'POST',body:{version:1,hash:c.hash,accountId:a.id,scheduledAt:c.payload.scheduledAt,acknowledged:true}})).json;
 assert.equal(c.state,'queued');assert.equal(c.jobs[0].lease_token,undefined);
 assert.equal((await req('/api/admin/xhs')).json.contents.length,1);
});
test('模块默认关闭不会创建数据库',async t=>{const f=fixture(t);const disabled=createHandler({isAdmin:()=>true,dir:path.join(f.dir,'not-created')});const req={method:'GET',headers:{}};let status;await disabled(req,{writeHead:s=>status=s,end(){}},new URL('https://fftql.team/api/admin/xhs'));assert.equal(status,404);assert.equal(fs.existsSync(path.join(f.dir,'not-created')),false);});
test('合成 H264 MP4 通过上传、私有 Range 播放和视频预览引用',async t=>{const f=fixture(t),req=f.request;
 const a=(await req('/api/admin/xhs/accounts',{method:'POST',body:{label:'video-test'}})).json;
 const b=fs.readFileSync(path.join(__dirname,'fixtures/synthetic.mp4'));
 const video=await req('/api/admin/xhs/assets',{method:'POST',body:b,headers:{'content-type':'video/mp4'}});assert.equal(video.code,201);
 const range=await req('/api/admin/xhs/assets/'+video.json.id,{headers:{range:'bytes=0-15'}});assert.equal(range.code,206);assert.deepEqual(range.raw,b.subarray(0,16));assert.equal(range.headers['Content-Range'],`bytes 0-15/${b.length}`);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l3sAAAAASUVORK5CYII=','base64');
 const cover=(await req('/api/admin/xhs/assets',{method:'POST',body:png,headers:{'content-type':'image/png'}})).json;
 let c=(await req('/api/admin/xhs/contents',{method:'POST',body:{payload:{title:'video test',body:'synthetic',type:'video',accountId:a.id,images:[],cover:cover.id,video:video.json.id,timezone:'UTC',localTime:'2027-01-01T09:00',expiresAt:'2027-01-02T00:00:00Z',isFpl:false}}})).json;
 c=(await req('/api/admin/xhs/contents/'+c.id+'/review',{method:'POST',body:{version:1}})).json;assert.equal(c.state,'pending');
});
