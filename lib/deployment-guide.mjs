import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=new URL('../docs/local-models/',import.meta.url);
export function deploymentGuide(id){
 const entries=readdirSync(root).filter(name=>name.endsWith('.json')).map(name=>({name,contract:JSON.parse(readFileSync(new URL(name,root),'utf8'))}));
 const selected=id?entries.find(entry=>entry.contract.id===id):entries.find(entry=>entry.name==='qwen-image-2.1.json');
 if(!selected)throw new Error('未知部署指南 '+id);
 if(selected.contract.backend.workflow && !selected.contract.backend.workflow.startsWith('vant-builtin-'))selected.contract.backend.workflow=fileURLToPath(new URL(selected.contract.backend.workflow,root));
 return {schema:'art-workshop/deployment-guide',id:selected.contract.id,contract:selected.contract,
  available:entries.map(entry=>({id:entry.contract.id,model:entry.contract.backend.model})),
  instructions:readFileSync(new URL(selected.name.replace(/\.json$/,'.md'),root),'utf8'),directory:fileURLToPath(root)};
}
