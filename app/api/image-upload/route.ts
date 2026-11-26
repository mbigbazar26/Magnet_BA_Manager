import { isAuthorized, isSameOrigin } from '@/lib/auth';
import { credentials } from '@/lib/meta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req:Request) {
  if (!isAuthorized(req)) return Response.json({error:'Sign in to continue.'},{status:401});
  if (!isSameOrigin(req)) return Response.json({error:'Use the local dashboard.'},{status:403});
  const length=Number(req.headers.get('content-length'));
  if (!Number.isFinite(length) || length > 5_300_000) return Response.json({error:'Choose an image smaller than 5 MB.'},{status:413});
  try {
    const form=await req.formData();
    const file=form.get('file');
    const mode=form.get('mode');
    if (!(file instanceof File) || !['image/jpeg','image/png'].includes(file.type) || file.size===0 || file.size>5_000_000) return Response.json({error:'Choose a JPEG or PNG image under 5 MB.'},{status:400});
    const bytes=new Uint8Array(await file.arrayBuffer());
    const jpeg=bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff;
    const png=bytes.length>=8 && [137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n);
    if ((file.type==='image/jpeg'&&!jpeg)||(file.type==='image/png'&&!png)) return Response.json({error:'Image content does not match the file type.'},{status:400});
    const config=credentials(), token=process.env.META_ACCESS_TOKEN!.trim();
    const base='https://graph.facebook.com/'+config.version+'/';
    async function result(response:Response) {
      const data=await response.json().catch(()=>null);
      if (!response.ok || data?.error) throw new Error(String(data?.error?.message || 'Meta rejected the upload.').replaceAll(token,'[redacted]').slice(0,500));
      return data;
    }
    if (mode==='example') {
      const appId=String(form.get('appId')||'').trim();
      if (!/^\d+$/.test(appId)) return Response.json({error:'Enter the Meta App ID for template image uploads.'},{status:400});
      const query=new URLSearchParams({file_name:file.name,file_length:String(file.size),file_type:file.type});
      const session=await result(await fetch(base+appId+'/uploads?'+query,{method:'POST',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)}));
      if (typeof session?.id!=='string' || !/^upload:[A-Za-z0-9:_-]+$/.test(session.id)) throw new Error('Meta returned an invalid upload session.');
      const uploaded=await result(await fetch(base+session.id,{method:'POST',headers:{Authorization:'OAuth '+token,'file_offset':'0','Content-Type':'application/octet-stream'},body:bytes,signal:AbortSignal.timeout(60000)}));
      if (typeof uploaded?.h!=='string') throw new Error('Meta did not return an upload handle.');
      return Response.json({handle:uploaded.h});
    }
    if (mode==='message') {
      const media=new FormData(); media.set('messaging_product','whatsapp'); media.set('type',file.type); media.set('file',file,file.name);
      const uploaded=await result(await fetch(base+config.phoneNumberId+'/media',{method:'POST',headers:{Authorization:'Bearer '+token},body:media,signal:AbortSignal.timeout(60000)}));
      if (typeof uploaded?.id!=='string' || !/^\d+$/.test(uploaded.id)) throw new Error('Meta did not return a media ID.');
      return Response.json({id:uploaded.id});
    }
    return Response.json({error:'Invalid upload type.'},{status:400});
  } catch(e) {return Response.json({error:e instanceof Error?e.message:'Image upload failed.'},{status:502});}
}
