"""models/ ichidagi manbalardan src/models.json yaratadi. Ishga tushirish: python3 tools/build_models.py"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from glbbake import load_glb, encode

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
K = os.path.join(ROOT, 'models', 'kenney')
# kalit -> manba fayl. Kalit index.html dagi MODELS[..].g va NPC ro'yxatida ishlatiladi.
KENNEY = ['van', 'hatchback-sports', 'sedan', 'taxi', 'sedan-sports', 'suv', 'suv-luxury',
          'race', 'race-future', 'police', 'delivery', 'truck']

def main():
    out = {}
    for k in KENNEY:
        out[k] = encode(load_glb(os.path.join(K, k + '.glb')))
    # Qo'shimcha (premium) modellar bo'lsa shu yerda ulanadi: tools/build_premium.py
    extra = os.path.join(ROOT, 'src', 'models_premium.json')
    if os.path.exists(extra):
        out.update(json.load(open(extra)))
    p = os.path.join(ROOT, 'src', 'models.json')
    json.dump(out, open(p, 'w'), separators=(',', ':'))
    print('models.json', os.path.getsize(p) // 1024, 'KB', len(out), 'ta model')
    for k, v in out.items():
        print(f"  {k:18s} L={v['L']:.2f} parts={len(v['p'])}")

main()
