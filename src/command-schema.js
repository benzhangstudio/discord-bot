// Validate our CHAT_INPUT payload before contacting Discord. Paths use Discord's
// zero-based error notation so operator logs identify the rejected field.
export function validateCommandSchema(commands) {
  const fail=(path,message)=>{throw new Error(`Invalid application command schema: ${path}: ${message}`);};
  const namePattern=/^[-_\u02BC\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;
  function visit(list,path,parent='root') {
    if(!Array.isArray(list))fail(path,'expected an array');
    if(list.length>(parent==='root'?100:25))fail(path,'too many entries');
    const names=new Set();let optional=false;
    const branches=list.some(item=>item?.type===1||item?.type===2);
    for(const [index,item] of list.entries()) {
      const here=path?`${path}[${index}]`:String(index);
      if(!item||typeof item!=='object')fail(here,'expected an object');
      if(typeof item.name!=='string'||!namePattern.test(item.name)||item.name!==item.name.toLowerCase())fail(`${here}.name`,'required lowercase command name (1–32 characters)');
      if(names.has(item.name))fail(`${here}.name`,'duplicate name');
      names.add(item.name);
      if(typeof item.description!=='string'||item.description.length<1||item.description.length>100)fail(`${here}.description`,'required description (1–100 characters)');
      if(!Number.isInteger(item.type)||item.type<1||item.type>(parent==='root'?1:11))fail(`${here}.type`,'invalid command or option type');
      if(parent==='group'&&item.type!==1)fail(`${here}.type`,'groups may contain only subcommands');
      if(parent==='sub'&&item.type<3)fail(`${here}.type`,'subcommands may contain only parameter options');
      if(parent!=='root'&&branches&&item.type>2)fail(here,'cannot mix subcommands and parameters');
      if(item.required!==undefined&&(typeof item.required!=='boolean'||item.type<3))fail(`${here}.required`,'required is only valid as a boolean on parameters');
      if(parent!=='root'&&item.type>=3) {
        if(item.required&&optional)fail(`${here}.required`,'required parameters must precede optional parameters');
        if(!item.required)optional=true;
      }
      if(item.options!==undefined) {
        if(parent!=='root'&&item.type>2)fail(`${here}.options`,'only subcommands and groups can contain options');
        visit(item.options,`${here}.options`,parent==='root'?'command':item.type===2?'group':'sub');
      }
      if(item.autocomplete!==undefined&&(typeof item.autocomplete!=='boolean'||![3,4,10].includes(item.type)))fail(`${here}.autocomplete`,'only string and numeric parameters support autocomplete');
      if(item.choices!==undefined) {
        if(![3,4,10].includes(item.type)||!Array.isArray(item.choices)||item.choices.length>25||item.autocomplete)fail(`${here}.choices`,'invalid choices or choices combined with autocomplete');
        for(const [n,choice] of item.choices.entries()) {
          if(!choice||typeof choice.name!=='string'||choice.name.length<1||choice.name.length>100)fail(`${here}.choices[${n}].name`,'invalid choice name');
          const valid=item.type===3?typeof choice.value==='string'&&choice.value.length<=100:typeof choice.value==='number'&&Number.isFinite(choice.value)&&(item.type!==4||Number.isSafeInteger(choice.value));
          if(!valid)fail(`${here}.choices[${n}].value`,'choice value must match parameter type');
        }
      }
    }
  }
  visit(commands,'');
  return commands;
}
