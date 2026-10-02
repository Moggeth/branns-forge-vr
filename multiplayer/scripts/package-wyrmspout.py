"""Retain the reviewed native geometry/sockets; repack embedded maps for the web."""
from pathlib import Path
from io import BytesIO
import hashlib,json,struct,time
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
started=time.perf_counter()
source=ROOT/'godot/assets/wyrmspout.glb'
data=source.read_bytes();size=struct.unpack_from('<I',data,12)[0]
doc=json.loads(data[20:20+size]);binary=data[28+size:]
image_views={image['bufferView'] for image in doc.get('images',[])}
packed=bytearray()
for index,view in enumerate(doc['bufferViews']):
    start=view.get('byteOffset',0);chunk=binary[start:start+view['byteLength']]
    if index in image_views:
        with Image.open(BytesIO(chunk)) as image:
            image.thumbnail((512,512),Image.Resampling.BOX)
            out=BytesIO();image.save(out,format='PNG',optimize=True);chunk=out.getvalue()
    packed.extend(b'\0'*(-len(packed)%4));view['byteOffset']=len(packed);view['byteLength']=len(chunk);packed.extend(chunk)
for image in doc.get('images',[]):image['mimeType']='image/png'
doc['buffers'][0]['byteLength']=len(packed);packed.extend(b'\0'*(-len(packed)%4))
header=json.dumps(doc,separators=(',',':')).encode();header+=b' '*(-len(header)%4)
target=ROOT/'multiplayer/public/assets/wyrmspout.glb'
target.write_bytes(struct.pack('<III',0x46546c67,2,28+len(header)+len(packed))+struct.pack('<II',len(header),0x4e4f534a)+header+struct.pack('<II',len(packed),0x004e4942)+packed)
manifest={'source':str(source.relative_to(ROOT)).replace('\\','/'),'source_sha256':hashlib.sha256(data).hexdigest(),'file':target.name,'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'texture_max_dimension':512,'geometry':'unchanged','seconds':round(time.perf_counter()-started,3)}
(target.parent/'import-wyrmspout.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print(json.dumps(manifest))
