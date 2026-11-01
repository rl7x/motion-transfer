import {deflateSync} from 'node:zlib';

function crc32(bytes){
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return(crc^0xffffffff)>>>0;
}
function chunk(kind,bytes){
  const type=Buffer.from(kind),header=Buffer.alloc(4),checksum=Buffer.alloc(4);header.writeUInt32BE(bytes.length);checksum.writeUInt32BE(crc32(Buffer.concat([type,bytes])));
  return Buffer.concat([header,type,bytes,checksum]);
}
// The native framebuffer packs four 2-bit pixels into each byte, low bits first.
export function framebufferPng(bytes,palette){
  const width=160,height=160;
  if(bytes.length!==width*height/4||palette.length!==4)throw Error('Expected a native 160×160 WASM-4 framebuffer');
  const pixels=Buffer.alloc(height*(1+width*3));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const pixel=y*width+x,color=palette[(bytes[pixel>>>2]>>((pixel&3)*2))&3],offset=y*(1+width*3)+1+x*3;
    pixels[offset]=(color>>>16)&255;pixels[offset+1]=(color>>>8)&255;pixels[offset+2]=color&255;
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
