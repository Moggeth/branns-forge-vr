"""Package the native ground prop atlas with browser-safe relative references."""
from pathlib import Path
import json, struct, hashlib, time
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
def build():
    began=time.perf_counter();dst=ROOT/'multiplayer/public/assets';source=ROOT/'godot/assets/ground-surface-kit';manifest=[]
    for path in (source/'materials').glob('prop_atlas*.png'):
        out=dst/path.name
        # Normal vectors are decoded/normalized by the material shader; box filtering
        # averages the source vector field without Lanczos ringing.
        with Image.open(path) as img:img.resize((1024,1024),Image.Resampling.BOX).save(out,optimize=True)
        manifest.append({'file':out.name,'source':str(path.relative_to(ROOT)).replace('\\','/'),'size':[1024,1024],'bytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest()})
    for target in dst.glob('*.glb'):
        native=source/'props'/target.name
        if not native.exists():continue
        data=native.read_bytes();size=struct.unpack_from('<I',data,12)[0];doc=json.loads(data[20:20+size]);changed=False
        for img in doc.get('images',[]):
            uri=img.get('uri','')
            if uri.startswith('../materials/prop_atlas'):
                img['uri']=Path(uri).name;assert (dst/img['uri']).is_file();changed=True
        if not changed:continue
        head=json.dumps(doc,separators=(',',':')).encode();head+=b' '*((-len(head))%4);tail=data[20+size:];target.write_bytes(struct.pack('<III',0x46546c67,2,20+len(head)+len(tail))+struct.pack('<II',len(head),0x4e4f534a)+head+tail)
        manifest.append({'file':target.name,'source':str(native.relative_to(ROOT)).replace('\\','/'),'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
    (dst/'import-ground-materials.json').write_text(json.dumps(manifest,indent=2)+'\n')
    # Keep the installed import register honest after reference rewriting.
    register=dst/'import-wave-1.json';items=json.loads(register.read_text())
    for item in items:
        path=dst/item['file']
        if any(x['file']==item['file'] for x in manifest):item.update(bytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest())
    register.write_text(json.dumps(items,indent=2)+'\n')
    print(f'Packaged {len(manifest)} ground assets in {time.perf_counter()-began:.3f}s')
if __name__=='__main__':build()
