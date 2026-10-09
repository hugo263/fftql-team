'use strict';
const {fail}=require('./domain.cjs');
// Structural validation plus local resource bounds; platform-specific limits live in rules.cjs.
function validateMedia(b,mime){
 let ok=false;
 try{
  if(mime==='image/png'){
   if(!b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))throw 0;
   let offset=8,ihdr=false,idat=false,end=false;
   while(offset+12<=b.length){
    const n=b.readUInt32BE(offset),type=b.toString('ascii',offset+4,offset+8);
    if(n>b.length-offset-12)throw 0;
    if(!ihdr){if(type!=='IHDR'||n!==13)throw 0;const w=b.readUInt32BE(offset+8),h=b.readUInt32BE(offset+12);if(!w||!h||w*h>40000000)throw 0;ihdr=true;}
    if(type==='IDAT'&&n>0)idat=true;
    offset+=n+12;
    if(type==='IEND'){if(n!==0||offset!==b.length)throw 0;end=true;break;}
   }
   ok=ihdr&&idat&&end;
  }else if(mime==='image/jpeg'){
   if(b[0]!==255||b[1]!==216||b[b.length-2]!==255||b[b.length-1]!==217)throw 0;
   let o=2,frame=false;
   while(o<b.length-2){if(b[o++]!==255)throw 0;while(b[o]===255)o++;const marker=b[o++];if(marker===0xda){ok=frame&&o+2<b.length-2;break;}
    const n=b.readUInt16BE(o);if(n<2||o+n>b.length-2)throw 0;
    if([0xc0,0xc1,0xc2].includes(marker)){if(n<8)throw 0;const h=b.readUInt16BE(o+3),w=b.readUInt16BE(o+5);if(!w||!h||w*h>40000000)throw 0;frame=true;}o+=n;
   }
  }else if(mime==='image/webp'){
   if(b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WEBP'||b.readUInt32LE(4)+8!==b.length)throw 0;
   let o=12,image=false;
   while(o+8<=b.length){const type=b.toString('ascii',o,o+4),n=b.readUInt32LE(o+4);if(n<1||o+8+n>b.length)throw 0;if(['VP8 ','VP8L'].includes(type))image=true;if(type==='ANIM'||type==='ANMF')throw 0;o+=8+n+(n%2);}
   ok=image&&o===b.length;
  }else if(mime==='video/mp4'){
   let o=0;const boxes=new Set();
   while(o+8<=b.length){let n=b.readUInt32BE(o);const type=b.toString('ascii',o+4,o+8);if(n===1){const big=b.readBigUInt64BE(o+8);if(big>BigInt(b.length))throw 0;n=Number(big);if(n<16)throw 0;}else if(n===0)n=b.length-o;
    if(n<8||o+n>b.length)throw 0;if(o===0&&(type!=='ftyp'||n<16))throw 0;
    if(type==='moov'&&n<16)throw 0;if(type==='mdat'&&n<=8)throw 0;boxes.add(type);o+=n;
   }
   ok=o===b.length&&['ftyp','moov','mdat'].every(x=>boxes.has(x));
  }
 }catch{ok=false;}
 if(!ok)fail('UNSUPPORTED_OR_DAMAGED_MEDIA');
}
module.exports={validateMedia};
