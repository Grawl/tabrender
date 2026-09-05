"""Mark linked stereo samples (type 2/4) as mono (type 1) so alphaTab's synth loads them."""
import struct,sys
src,dst=sys.argv[1],sys.argv[2] if len(sys.argv)>2 else None
data=bytearray(open(src,'rb').read())
assert data[:4]==b'RIFF' and data[8:12]==b'sfbk'
pos=12; shdr=None
while pos<len(data):
    cid=data[pos:pos+4]; size=struct.unpack('<I',data[pos+4:pos+8])[0]
    if cid==b'LIST':
        ltype=data[pos+8:pos+12]
        if ltype==b'pdta':
            p=pos+12; end=pos+8+size
            while p<end:
                sid=data[p:p+4]; ssize=struct.unpack('<I',data[p+4:p+8])[0]
                if sid==b'shdr': shdr=(p+8,ssize)
                p+=8+ssize+(ssize&1)
        pos+=8+size+(size&1)
    else: pos+=8+size+(size&1)
off,size=shdr; n=size//46; counts={}; patched=0
for i in range(n):
    r=off+i*46; link,typ=struct.unpack('<HH',data[r+42:r+46]); counts[typ]=counts.get(typ,0)+1
    if typ in (2,4):
        struct.pack_into('<HH',data,r+42,0,1); patched+=1
print(f'{src}: {n} samples, types {counts}, patched {patched}')
if dst and patched: open(dst,'wb').write(data); print('wrote',dst)
