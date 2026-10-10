import {createServer} from 'node:http';
const port=Number(process.argv[2]),delay=Number(process.argv[3]??50);
const histories={},running=new Map();let count=0;
const server=createServer(async(req,res)=>{
  let text='';for await(const c of req)text+=c;
  const path=new URL(req.url,'http://localhost').pathname;
  const json=x=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(x));};
  if(path==='/upload/image')return json({name:'uploaded.png',subfolder:'art',type:'input'});
  const body=text?JSON.parse(text):{};
  if(path==='/system_stats')return json({system:{comfyui_version:'0.39.0'}});
  if(path==='/object_info')return json(Object.fromEntries(['UnetLoaderGGUF','CLIPLoader','VAELoader','TextEncodeQwenImage21','EmptyLatentImage','KSampler','VAEDecode','SaveImage','LoadImage'].map(x=>[x,{}])));
  if(path==='/queue'&&req.method==='GET')return json({queue_running:[...running.keys()].map(id=>[0,id]),queue_pending:[]});
  if(path==='/queue')return json({});
  if(path==='/prompt'){
    if(body.prompt['6']?.inputs.steps===666){res.statusCode=400;return json({error:{type:'prompt_outputs_failed_validation'},node_errors:{'1':{class_type:'UnetLoaderGGUF',errors:[{type:'value_not_in_list',message:'模型不在可选列表',details:'missing.gguf'}]}}});}
    const id='prompt-'+(++count);running.set(id,body.prompt);
    setTimeout(()=>{if(!running.has(id))return;running.delete(id);histories[id]=body.prompt['6']?.inputs.steps===667?{status:{completed:false,status_str:'error',messages:[['execution_error',{node_id:'6',node_type:'KSampler',exception_type:'torch.OutOfMemoryError',exception_message:'CUDA out of memory',traceback:['mock traceback']}]]},outputs:{}}:{status:{completed:true,status_str:'success'},outputs:{8:{images:[{filename:id+'.png',subfolder:'',type:'output'}]}},prompt:body.prompt};},delay).unref();
    return json({prompt_id:id,node_errors:body.prompt['6']?.inputs.steps===668?{'1':{class_type:'UnetLoaderGGUF',errors:[{message:'partially accepted workflow'}]}}:{}});
  }
  if(path.startsWith('/history/')){const id=decodeURIComponent(path.split('/').at(-1));return json(histories[id]?{[id]:histories[id]}:{});}
  if(path==='/interrupt'){
    for(const id of [...running.keys()])if(!body.prompt_id||body.prompt_id===id){running.delete(id);histories[id]={status:{completed:true,status_str:'error',messages:['interrupted']},outputs:{}};}
    res.end();return;
  }
  if(path==='/view'){res.setHeader('Content-Type','image/png');res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP3sAAAAASUVORK5CYII=','base64'));return;}
  res.statusCode=404;json({error:path});
});
server.listen(port,'127.0.0.1');
