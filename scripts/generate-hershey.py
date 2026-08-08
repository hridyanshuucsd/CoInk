#!/usr/bin/env python3
"""Convert a Hershey SVG font with M/L/C/Z paths into CoInk JS stroke data.

Usage:
    python scripts/generate-hershey.py /path/to/HersheyScriptMed.svg public/hershey-glyphs.js

The source font's license/acknowledgement requirements remain applicable to the
converted data. Keep NOTICE-HERSHEY.md with redistributed output.
"""
import sys, re, json
import xml.etree.ElementTree as ET
from pathlib import Path

src=Path(sys.argv[1]); out=Path(sys.argv[2])
root=ET.parse(src).getroot(); ns={'s':'http://www.w3.org/2000/svg'}
font=root.find('.//s:font',ns); face=root.find('.//s:font-face',ns)
def_adv=float(font.attrib.get('horiz-adv-x','378'))

def parse(d):
    toks=re.findall(r'[MLCZ]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?', d or '')
    i=0;cmd=None;cur=(0.,0.);start=cur;strokes=[];stroke=[]
    def add(pt):
        if not stroke or pt!=tuple(stroke[-1]): stroke.append([round(pt[0],3),round(pt[1],3)])
    while i<len(toks):
        if toks[i] in 'MLCZ':cmd=toks[i];i+=1
        if cmd=='M':
            if stroke:strokes.append(stroke);stroke=[]
            cur=(float(toks[i]),float(toks[i+1]));i+=2;start=cur;add(cur);cmd='L'
        elif cmd=='L':
            cur=(float(toks[i]),float(toks[i+1]));i+=2;add(cur)
        elif cmd=='C':
            x1,y1,x2,y2,x3,y3=map(float,toks[i:i+6]);i+=6;p0=cur
            for k in range(1,9):
                t=k/8;u=1-t
                add((u**3*p0[0]+3*u*u*t*x1+3*u*t*t*x2+t**3*x3,
                     u**3*p0[1]+3*u*u*t*y1+3*u*t*t*y2+t**3*y3))
            cur=(x3,y3)
        elif cmd=='Z':add(start);cmd=None
    if stroke:strokes.append(stroke)
    return [s for s in strokes if len(s)>=2]

g={}
for el in root.findall('.//s:glyph',ns):
    ch=el.attrib.get('unicode')
    if ch and len(ch)==1:g[ch]={'a':float(el.attrib.get('horiz-adv-x',def_adv)),'s':parse(el.attrib.get('d',''))}
g.setdefault(' ',{'a':def_adv,'s':[]})
meta={'name':'Hershey Script Medium','unitsPerEm':float(face.attrib.get('units-per-em','1000'))}
out.write_text('// Generated stroke data. See NOTICE-HERSHEY.md.\nexport const HERSHEY_META = '+json.dumps(meta,separators=(',',':'))+';\nexport const HERSHEY_GLYPHS = '+json.dumps(g,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf8')
print(f'wrote {len(g)} glyphs to {out}')
