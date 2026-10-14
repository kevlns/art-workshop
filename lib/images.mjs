import sharp from 'sharp';
export async function validateImage(buffer){
 if(!Buffer.isBuffer(buffer)||buffer.length>20*1024*1024)throw new Error('单张图片最大 20MB');
 try{
  const pipeline=sharp(buffer,{limitInputPixels:64*1024*1024,failOn:'warning'}),metadata=await pipeline.metadata();
  if(!['png','jpeg','webp'].includes(metadata.format)||!metadata.width||!metadata.height||metadata.pages>1)throw new Error('只支持单帧 PNG/JPEG/WebP');
  await pipeline.resize(1,1).raw().toBuffer();
  return {format:metadata.format,width:metadata.width,height:metadata.height};
 }catch(error){throw new Error('图片无法完整解码：'+error.message);}
}
