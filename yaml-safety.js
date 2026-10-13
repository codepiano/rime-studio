// ConfigStore evaluates slash-style patches; reject prototype paths before they
// can be saved by a package merge or an imported migration file.
export function safeConfigKeys(value,visiting=new WeakSet()){
 if(!value||typeof value!=='object')return;
 if(visiting.has(value))throw new Error('配置包含循环引用');visiting.add(value);
 for(const [key,child] of Object.entries(value)){if(key.split('/').some(part=>['__proto__','constructor','prototype'].includes(part)))throw new Error('配置含有不安全的补丁路径');safeConfigKeys(child,visiting);}
 visiting.delete(value);
}
