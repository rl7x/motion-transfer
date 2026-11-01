// Validate the same bounded JSON schema subset exposed to the model.
export function validateSchema(value,schema,path='tool'){
  if(schema.type==='object'){
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==schema.required.length||schema.required.some(key=>!Object.hasOwn(value,key)))throw Error('Invalid fields at '+path);
    for(const [key,child]of Object.entries(schema.properties))validateSchema(value[key],child,path+'.'+key);
  }else if(schema.type==='array'){
    if(!Array.isArray(value)||value.length<(schema.minItems??0)||value.length>(schema.maxItems??Infinity))throw Error('Invalid array at '+path);
    value.forEach(item=>validateSchema(item,schema.items,path));
  }else if(schema.type==='string'){
    if(typeof value!=='string'||!value.trim()||value.length<(schema.minLength??1)||value.length>(schema.maxLength??Infinity)||(schema.pattern&&!new RegExp(schema.pattern).test(value)))throw Error('Invalid string at '+path);
  }else if((schema.type==='integer'?!Number.isSafeInteger(value):typeof value!=='number'||!Number.isFinite(value))||value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity))throw Error('Invalid number at '+path);
  if(schema.enum&&!schema.enum.includes(value))throw Error('Invalid choice at '+path);
}
