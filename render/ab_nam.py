"""A/B: guitar excerpt through several amp captures (NAM full rigs vs Proteus+IR), with drums and bass."""
import sys, json, time, subprocess, numpy as np, soundfile as sf
from tabrender import midi_events, guitar, fluid, drums, drumkit
SR=44100; SECS=float(sys.argv[1]); variants=sys.argv[2:]
m=json.load(open('out/tombstone.json')); chs=midi_events.parse('out/tombstone.mid')
root='assets/sfz/UI_METAL-GTX/Programs/'; kit=guitar.GuitarKit(root, root+'Individual Patchs/METAL-GTX_Full/')
gch=chs[0]; gch.notes=[n for n in gch.notes if n.start<SECS]
takes=[kit.render(gch, m['articulations'], 0, SR, SECS+1, take=t) for t in (0,1)]
dch=chs[9]; dch.notes=[n for n in dch.notes if n.start<SECS]
for n in dch.notes: n.velocity=min(127,n.velocity+25)
dr=drumkit.DrumKit('assets/drums/ALL.sfz').render([dch], SR, SECS+1); dr/=abs(dr).max()+1e-9
kick=drums.synth_kick([n.start for n in dch.notes if n.pitch in drums.KICK_NOTES], len(dr), SR); kick/=abs(kick).max()+1e-9
bass=fluid.render('out/tombstone.mid', {6,7}, 'assets/FluidR3_GM_mono.sf2', SR)[:len(dr)]; bass/=abs(bass).max()+1e-9
def pan(x,p):
    a=(p+1)/2*np.pi/2; return np.stack([x*np.cos(a), x*np.sin(a)],1)
for v in variants:
    label, ampf, irf, gain = v.split(':'); irf=irf or None
    chain=guitar.AmpChain(ampf, irf, SR, input_gain=float(gain), pre_hpf=120, post_hpf=70, post_lpf=9000)
    t=time.time(); L=chain.process(takes[0]); R=chain.process(takes[1]); print(label,'amp',round(time.time()-t,1),'s', flush=True)
    n=min(len(L),len(dr)); mix=np.zeros((n,2),np.float32)
    mix+=pan(L[:n],-0.8)*0.45+pan(R[:n],0.8)*0.45+dr[:n]*0.9+kick[:n,None]*0.5+bass[:n]*0.6
    mix=drums.limiter(mix,SR); sf.write('out/ab.wav',mix,SR)
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i','out/ab.wav','-b:a','192k',f'out/{label}.mp3'],check=True); print('->',label)
