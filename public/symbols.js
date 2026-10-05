const names={
 '·':{name:'人名间隔号',aliases:['外国人名','人名','外国名字','姓名','圆点','中间点','中点','中间圆点','间隔号'],example:'约翰·史密斯'},
 '、':{name:'顿号',aliases:['顿号','列举','并列'],example:'苹果、梨、桃子'},
 '……':{name:'省略号',aliases:['省略号','六个点','六个圆点','省略'],example:'故事还没有结束……'},
 '—':{name:'破折号',aliases:['破折号','长横线','横线'],example:'这是一个解释——补充说明'},
 '——':{name:'破折号',aliases:['破折号','长横线','横线'],example:'这是一个解释——补充说明'},
 '“':{name:'左双引号',aliases:['双引号','引号','左引号','开引号'],example:'“你好”'},
 '”':{name:'右双引号',aliases:['双引号','引号','右引号','闭引号'],example:'“你好”'},
 '「':{name:'左直角引号',aliases:['直角引号','方引号','引号'],example:'「你好」'},
 '」':{name:'右直角引号',aliases:['直角引号','方引号','引号'],example:'「你好」'},
 '《':{name:'左书名号',aliases:['书名号','书籍','书名'],example:'《红楼梦》'},
 '》':{name:'右书名号',aliases:['书名号','书籍','书名'],example:'《红楼梦》'},
 '×':{name:'乘号',aliases:['乘号','乘法','乘以'],example:'3 × 4'},
 '÷':{name:'除号',aliases:['除号','除法','除以'],example:'12 ÷ 3'},
 '°':{name:'度数符号',aliases:['度数','角度','温度','度符号'],example:'90°'},
 '℃':{name:'摄氏度',aliases:['温度','摄氏度','度符号'],example:'25℃'},
 '￥':{name:'人民币符号',aliases:['人民币','价格','货币','钱'],example:'￥100'},
 '€':{name:'欧元符号',aliases:['欧元','货币','钱'],example:'€100'},
 '§':{name:'章节符号',aliases:['章节','节号','段落'],example:'§ 1'},
};
const popular=['·','、','……','——','“','”','《','》','×','÷','°','℃','￥'];
const shifted={'|':'Shift + \\','!':'Shift + 1','@':'Shift + 2','#':'Shift + 3','$':'Shift + 4','%':'Shift + 5','^':'Shift + 6','&':'Shift + 7','*':'Shift + 8','(':'Shift + 9',')':'Shift + 0','_':'Shift + -','+':'Shift + =','{':'Shift + [','}':'Shift + ]',':':'Shift + ;','"':"Shift + '",'<':'Shift + ,','>':'Shift + .','?':'Shift + /','~':'Shift + `'};
export function lookupSymbols(schema,term=''){
 const config=schema?.deployedConfig;if(!schema?.deployed||!config?.punctuator)return [];
 const found=new Map();
 function add(character,key,kind,index,mode){
  if(typeof character!=='string'||!character||/^\s+$/.test(character))return;
  let item=found.get(character);if(!item){item={character,...(names[character]||{name:'符号',aliases:[],example:''}),routes:[]};found.set(character,item);}
  let route=item.routes.find(r=>r.key===key&&r.kind===kind&&r.index===index);
  if(!route){route={key,keyLabel:shifted[key]||key,kind,index,modes:[]};item.routes.push(route);}if(!route.modes.includes(mode))route.modes.push(mode);
 }
 for(const [field,mode] of [['half_shape','半角'],['full_shape','全角']]){
  for(const [key,v] of Object.entries(config.punctuator[field]||{})){
   if(key.startsWith('__'))continue;
   if(typeof v==='string')add(v,key,'direct',0,mode);
   else if(Array.isArray(v))v.forEach((char,i)=>add(char,key,'candidate',i+1,mode));
   else if(v&&typeof v==='object'){
    if(typeof v.commit==='string')add(v.commit,key,'direct',0,mode);
    if(Array.isArray(v.pair))v.pair.forEach((char,i)=>add(char,key,'pair',i+1,mode));
   }
  }
 }
 const terms=term.toLowerCase().trim().split(/\s+/).filter(Boolean);
 const list=[...found.values()];
 const rank=r=>r.kind==='direct'?0:r.kind==='pair'?1:r.index+2;
 for(const item of list)item.routes.sort((a,b)=>rank(a)-rank(b)||Number(b.modes.includes('半角'))-Number(a.modes.includes('半角')));

 if(!terms.length)return list.filter(item=>popular.includes(item.character)).sort((a,b)=>popular.indexOf(a.character)-popular.indexOf(b.character));
 return list.filter(item=>terms.every(t=>item.character===t||[item.name,...item.aliases,item.example,...item.routes.map(r=>r.key+' '+r.keyLabel)].join(' ').toLowerCase().includes(t)||item.aliases.some(alias=>t.includes(alias))));
}
