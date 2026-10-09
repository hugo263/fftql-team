'use strict';
const fs=require('node:fs');const {fail,hash,safeUrl,instant}=require('./domain.cjs');
// No default platform limits. Only a locally reviewed account-specific evidence file may supply them.
function loadRules(file){
 if(!file)return null;
 const r=JSON.parse(fs.readFileSync(file,'utf8'));
 if(r.verified!==true||typeof r.accountId!=='string'||!r.accountId||!r.sourceUrl||!r.checkedAt||!r.validUntil)fail('INVALID_VERIFIED_RULES');
 safeUrl(r.sourceUrl);instant(r.checkedAt);instant(r.validUntil);
 for(const type of ['image','video']){
  const spec=r[type];if(!spec)continue;
  for(const key of Object.keys(spec)){
   if(!['maxTitleCharacters','maxBodyCharacters','maxImages','maxAssetBytes','mimeTypes'].includes(key))fail('UNKNOWN_RULE');
   if(key==='mimeTypes'){if(!Array.isArray(spec[key])||spec[key].some(v=>!['image/png','image/jpeg','image/webp','video/mp4'].includes(v)))fail('INVALID_RULE');}
   else if(!Number.isSafeInteger(spec[key])||spec[key]<1)fail('INVALID_RULE');
  }
 }
 return {...r,checkedAt:instant(r.checkedAt),validUntil:instant(r.validUntil),digest:hash(r)};
}
function validateRules(s,p){
 const r=s.rules;
 if(!r||r.accountId!==p.accountId)return {verified:false};
 if(r.validUntil<=s.now())fail('PLATFORM_RULES_EXPIRED');
 const spec=r[p.type];if(!spec)return {verified:false};
 if(spec.maxTitleCharacters&&Array.from(p.title).length>spec.maxTitleCharacters)fail('PLATFORM_TITLE_LIMIT');
 if(spec.maxBodyCharacters&&Array.from(p.body).length>spec.maxBodyCharacters)fail('PLATFORM_BODY_LIMIT');
 if(spec.maxImages&&p.images.length>spec.maxImages)fail('PLATFORM_IMAGE_COUNT_LIMIT');
 for(const id of [...p.images,p.video,p.cover].filter(Boolean)){
  const a=s.get('SELECT * FROM xhs_assets WHERE id=?',id);if(!a)continue;
  if(spec.maxAssetBytes&&a.bytes>spec.maxAssetBytes)fail('PLATFORM_ASSET_SIZE_LIMIT');
  if(spec.mimeTypes&&!spec.mimeTypes.includes(a.mime))fail('PLATFORM_MIME_LIMIT');
 }
 return {verified:true,digest:r.digest};
}
module.exports={loadRules,validateRules};
