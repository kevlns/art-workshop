// Spine stores weighted vertices as counts followed by (bone index, local x, local y, weight).
export function applyBinding(rig,{bones=[],meshes=[]}) {
  for(const bone of bones) {
    if(!bone?.name) throw Error('缺少骨名');
    const prior=rig.bones.find(existing=>existing.name===bone.name);
    if(prior) Object.assign(prior,bone);
    else rig.bones.push(bone);
  }
  const indices=new Map(rig.bones.map((bone,i)=>[bone.name,i]));
  if(indices.size!==rig.bones.length) throw Error('骨名重复');
  for(const mesh of meshes) {
    const skin=rig.skins.find(s=>s.name===(mesh.skin??'default'));
    const slot=skin?.attachments?.[mesh.slot], name=mesh.attachment??mesh.slot;
    if(!slot || !Object.hasOwn(slot,name)) throw Error('找不到待绑定的附件：'+name);
    const {uvs,triangles,points}=mesh;
    if(!Array.isArray(points)||points.length<3||uvs?.length!==points.length*2||!uvs.every(Number.isFinite)||
       !Array.isArray(triangles)||!triangles.length||triangles.length%3||triangles.some(i=>!Number.isInteger(i)||i<0||i>=points.length))throw Error('网格 UV、顶点或三角索引无效');
    const vertices=[];
    for(const weights of points) {
      if(!Array.isArray(weights)||!weights.length) throw Error('每个顶点需要骨骼影响');
      vertices.push(weights.length);
      let sum=0;
      for(const [bone,x,y,weight] of weights) {
        if(!indices.has(bone)||![x,y,weight].every(Number.isFinite)||weight<=0) throw Error('顶点绑定无效：'+bone);
        sum+=weight;vertices.push(indices.get(bone),x,y,weight);
      }
      if(Math.abs(sum-1)>0.0001)throw Error('每个顶点的权重和应为 1');
    }
    slot[name]={type:'mesh',path:mesh.path??slot[name].path??name,uvs,triangles,vertices,hull:mesh.hull??points.length};
  }
}
