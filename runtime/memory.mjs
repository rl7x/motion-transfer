const TYPES = {
  u8: [1, 'getUint8'], i8: [1, 'getInt8'],
  u16: [2, 'getUint16'], i16: [2, 'getInt16'],
  u32: [4, 'getUint32'], i32: [4, 'getInt32'],
  f32: [4, 'getFloat32'], f64: [8, 'getFloat64'],
};
export const MEMORY_TYPES = Object.keys(TYPES);
export const memoryTypeSize=type=>TYPES[type]?.[0];

export function validateMemoryEdit(edit,byteLength=65_536){
  const size=memoryTypeSize(edit?.type);
  if(!size||!Number.isSafeInteger(edit.address)||edit.address<0||edit.address+size>byteLength)throw Error('Memory edit is outside linear memory or has an unsupported type');
  if(typeof edit.value!=='number'||!Number.isFinite(edit.value))throw Error('Memory edits require finite numeric values');
  if(edit.type[0]!=='f'){
    const signed=edit.type[0]==='i',bits=size*8;
    if(!Number.isSafeInteger(edit.value)||edit.value<(signed?-(2**(bits-1)):0)||edit.value>(signed?2**(bits-1)-1:2**bits-1))throw Error('Memory edit value does not fit its type');
  }else if(edit.type==='f32'&&!Number.isFinite(Math.fround(edit.value)))throw Error('Memory edit overflows float32');
}

export function writeMemoryValue(buffer,edit){
  validateMemoryEdit(edit,buffer.byteLength);
  const watch={name:'edited value',address:edit.address,type:edit.type,count:1};
  const previous=readMemoryWatches(buffer,[watch])[0];
  const setter=TYPES[edit.type][1].replace('get','set');
  new DataView(buffer)[setter](edit.address,edit.value,true);
  const next=readMemoryWatches(buffer,[watch])[0];
  return{previousValue:previous.values[0],previousBytesHex:previous.bytesHex,newValue:next.values[0],newBytesHex:next.bytesHex};
}

export function compareMemoryValues(before,after,{address,byteLength,type}){
  const size=memoryTypeSize(type);
  if(!size||!Number.isSafeInteger(address)||address<0||!Number.isSafeInteger(byteLength)||byteLength<1||byteLength>4096||byteLength%size||address+byteLength>Math.min(before.byteLength,after.byteLength))throw Error('Compare an in-bounds range of at most 4096 bytes, aligned to the selected type size');
  const a=new DataView(before),b=new DataView(after),getter=TYPES[type][1],changes=[];let changedValues=0;
  for(let offset=address;offset<address+byteLength;offset+=size){
    const previous=a[getter](offset,true),next=b[getter](offset,true);
    const sameBytes=Buffer.from(before,offset,size).equals(Buffer.from(after,offset,size));
    if(sameBytes)continue;
    changedValues++;
    if(changes.length<64)changes.push({address:offset,type,previousValue:jsonNumber(previous),newValue:jsonNumber(next)});
  }
  return{address,byteLength,type,comparedValues:byteLength/size,changedValues,changes,omittedChanges:Math.max(0,changedValues-changes.length),notice:'Candidate fields only. Correlation does not establish a variable identity or causality.'};
}

export function validateMemoryWatches(watches, byteLength = 65_536) {
  if (!Array.isArray(watches) || watches.length > 8) throw new Error('Use at most 8 memory watches');
  const names = new Set();
  let values = 0;
  for (const watch of watches) {
    const keys = ['name', 'address', 'type', 'count'];
    if (!watch || typeof watch !== 'object' || Array.isArray(watch)
      || Object.keys(watch).length !== keys.length || keys.some(key => !Object.hasOwn(watch, key))) {
      throw new Error('A memory watch needs only name, address, type, and count');
    }
    if (typeof watch.name !== 'string' || !watch.name.trim() || watch.name.length > 40 || names.has(watch.name)) {
      throw new Error('Memory watch names must be unique and contain 1–40 characters');
    }
    if (typeof watch.type !== 'string' || !Object.hasOwn(TYPES, watch.type)
      || !Number.isSafeInteger(watch.count) || watch.count < 1 || watch.count > 16) {
      throw new Error('A memory watch needs a supported numeric type and count of 1–16');
    }
    if (!Number.isSafeInteger(watch.address) || watch.address < 0
      || watch.address + TYPES[watch.type][0] * watch.count > byteLength) {
      throw new Error('Memory watch is outside linear memory');
    }
    names.add(watch.name);
    values += watch.count;
  }
  if (values > 64) throw new Error('Memory watches cannot exceed 64 total values');
}

function jsonNumber(value) {
  if (!Number.isFinite(value)) return String(value);
  return Object.is(value, -0) ? '-0' : value;
}

export function readMemoryWatches(buffer, watches) {
  validateMemoryWatches(watches, buffer.byteLength);
  const data = new DataView(buffer);
  return watches.map(watch => {
    const [size, getter] = TYPES[watch.type];
    return {
      ...watch,
      bytesHex: Buffer.from(buffer, watch.address, size * watch.count).toString('hex'),
      values: Array.from({ length: watch.count }, (_, index) => jsonNumber(data[getter](watch.address + index * size, true))),
    };
  });
}
