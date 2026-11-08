"""src/index.src.html + src/models.json -> game/index.html (Flutter assets/game/index.html ga qo'yiladi)."""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = open(os.path.join(ROOT, 'src', 'index.src.html'), encoding='utf-8').read()
m = open(os.path.join(ROOT, 'src', 'models.json'), encoding='utf-8').read()
c = open(os.path.join(ROOT, 'src', 'cities.json'), encoding='utf-8').read() if os.path.exists(os.path.join(ROOT, 'src', 'cities.json')) else '{}'
assert s.count('/*@@MODELS@@*/{}') == 1 and s.count('/*@@CITIES@@*/{}') == 1
out = s.replace('/*@@MODELS@@*/{}', m).replace('/*@@CITIES@@*/{}', c)
os.makedirs(os.path.join(ROOT, 'game'), exist_ok=True)
p = os.path.join(ROOT, 'game', 'index.html')
open(p, 'w', encoding='utf-8').write(out)
print('game/index.html', os.path.getsize(p) // 1024, 'KB')
