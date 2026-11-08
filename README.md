# Andijon RP

3D ko'p o'yinchili (multiplayer) roleplay o'yini — Flutter ilovasi ichida WebView orqali ishlaydi (Three.js), server esa Cloudflare Worker.

## Nima tayyor, nima yo'q edi

Oldingi `andijon-rp-apk.zip` ichida faqat **tayyor o'yin fayli** (`assets/game/index.html`) bor edi — server kodi umuman yo'q edi ("server kodi bizda YO'Q" — avvalgi HANDOFF.md'ga qarang). Shu safar:

- **Dizayn** — login ekrani va HUD butunlay qayta ishlandi: o'z brendi ("Andijon RP"), tungi shahar siluet fon, mos ranglar (oltin/moviy), Google Fonts (Manrope + Unbounded). Generic shablon ko'rinishidan chiqdi.
- **Server yozildi** — `worker/` papkasida, noldan: login/ro'yxatdan o'tish (parol xavfsiz PBKDF2 bilan hash qilinadi), pul/mashina/rol **Cloudflare D1**'da saqlanadi, real-vaqt harakat/chat/mashina sinxronizatsiyasi **Durable Object** + WebSocket orqali. Owner akkaunt (`aliyorbek`) alohida secret parol bilan himoyalangan.
- **Flutter ilovasi** — `lib/main.dart`, o'yinni WebView'da ochadi.
- **GitHub Actions** — push qilinganda **avtomatik APK yig'adi** (pastga qarang).

## "Zipni GitHub'ga qo'ysam, Actions o'zi build qiladimi?" — Ha

`.github/workflows/build.yml` fayli shu papkada bor. Siz bu loyihani (shu zip ichidagi hammasini) o'z GitHub repongizga push qilsangiz:

1. GitHub avtomatik `Build APK` workflow'ini ishga tushiradi (push bo'lgani uchun).
2. U Flutter SDK'ni o'rnatadi, Android loyihasini (`android/` papka) **o'zi generatsiya qiladi** (chunki biz uni repoga qo'shmadik — shunda eski Gradle versiyasi muammo qilmaydi), so'ng `flutter build apk --release` ishga tushadi.
3. Tugagach, **Actions** tabida o'sha run ichida **Artifacts** bo'limidan `andijon-rp-apk` nomli faylni yuklab olasiz — ichida `app-release.apk`.

Eslatma: bu APK hozircha **debug kalit bilan imzolangan** (Flutter standart holati) — testlash/ulashish uchun yetarli, lekin Google Play'ga chiqarish uchun o'z `keystore`ingiz bilan qayta imzolash kerak bo'ladi (aytsangiz, shuni ham sozlab beraman).

### Qo'lda qadamlar (push qilishdan oldin)

```bash
git init
git add .
git commit -m "Andijon RP: dizayn + server + Flutter + CI"
git remote add origin https://github.com/<SIZNING_AKKAUNT>/<REPO>.git
git push -u origin main
```

Shundan keyin GitHub'dagi repo sahifasida **Actions** tabini oching — build ishga tushganini ko'rasiz.

## Serverni deploy qilish (Cloudflare Worker)

Server kodi — `worker/` papkada. Siz "qo'lda deploy qilaman" dedingiz, shunga ko'ra:

```bash
cd worker
npm install -g wrangler        # agar o'rnatilmagan bo'lsa
npx wrangler login

# 1) D1 (ma'lumotlar bazasi) yaratish — faqat BIR MARTA:
npx wrangler d1 create andijon-rp-db
#   -> chiqqan "database_id" ni wrangler.toml ichidagi REPLACE_WITH_YOUR_D1_DATABASE_ID o'rniga yozing

# 2) Jadval yaratish:
npx wrangler d1 execute andijon-rp-db --remote --file=./schema.sql

# 3) Owner parolini "secret" sifatida qo'shish (hech qayerda ochiq yozilmaydi):
npx wrangler secret put OWNER_PASS
#   so'ralganda: Aliyorbek2011 (yoki xohlagan yangi parolni) kiriting

# 4) Deploy:
npx wrangler deploy
```

Deploy tugagach manzil `https://andijon-rp.<SIZNING_SUBDOMEN>.workers.dev` bo'ladi. O'yin klienti aynan `wss://andijon-rp.eco-school.workers.dev` ni kutyapti (`src/index.src.html` ichida `SERVER` o'zgaruvchisi) — agar sizning Cloudflare akkaunt subdomeningiz `eco-school` bo'lsa, hech narsa o'zgartirish shart emas. Boshqacha bo'lsa, `src/index.src.html`dagi `const SERVER=...` qatorini yangilab, `python3 tools/build_index.py` ni qayta ishga tushiring (bu `assets/game/index.html`ni qayta yasaydi — keyin uni `assets/game/index.html`ga ko'chiring).

Server ishga tushgach, brauzerda `https://andijon-rp.<subdomen>.workers.dev/` ni ochib tekshiring — "Andijon RP server ishlayapti ✅" chiqishi kerak. Shundan keyin o'yin ichidagi "Server javob bermadi" xatosi tugaydi.

### Owner akkaunt haqida muhim eslatma

Avvalgi hujjatda (`docs/OWNER_ACCOUNT.md`) owner paroli **ochiq matnda** yozilgan edi. Endi parol faqat `wrangler secret put OWNER_PASS` orqali Cloudflare'ning o'zida, shifrlangan holda saqlanadi — hech qanday fayl yoki repoda yozilmaydi. Shu parolni boshqa joyda ishlatmaslikni tavsiya qilamiz.

## Dizaynni yana o'zgartirish / o'yinni qayta yig'ish

Tahrirlanadigan manba — `src/index.src.html` (CSS/HTML/JS shu yerda, mashina/shahar modellari esa `src/models.json` va `src/cities.json`'dan avtomatik qo'shiladi). O'zgartirgandan keyin:

```bash
python3 tools/build_index.py
```

Bu `assets/game/index.html`ni qayta yasaydi (Flutter shu faylni ishlatadi). `numpy` va `Pillow` kerak: `pip install numpy pillow`.

## Ma'lum cheklovlar (keyingi safar qilish kerak)

Bular dizayn/server ishidan tashqarida, hali ham mavjud (oldingi loyihadan meros, bu safar qo'l tegmadi):

- **Shahar binolariga to'qnashuv o'chiq** (`CITY_COLLIDE=false` — `src/index.src.html`da), ya'ni Vatikan va ortogonal shahar binolaridan mashina/piyoda o'tib ketaveradi. Yoqib ko'rish uchun shu qatorni `true` qiling va sinab ko'ring (ko'cha kataklari noto'g'ri bloklanishi mumkin).
- **Minimap** hali faqat markaziy 400x400 maydon uchun mo'ljallangan — yangi shaharlarda nuqta xaritadan chiqib ketishi mumkin.
- Haqiqiy telefon/APK'da hali sinalmagan — birinchi marta APK yig'ib, haydov yo'nalishi/tezlik/FPS'ni tekshirish tavsiya qilinadi.

## Papkalar

```
lib/main.dart                 Flutter WebView ilovasi
assets/game/index.html        Tayyor o'yin (bitta fayl, build qilingan)
src/index.src.html            Tahrirlanadigan manba (dizayn shu yerda)
src/*.json                    Mashina/shahar modellari (bake qilingan)
tools/build_index.py          Manba + json -> assets/game/index.html
worker/                       Cloudflare Worker server kodi (yangi yozilgan)
worker/schema.sql             D1 jadval sxemasi
.github/workflows/build.yml   GitHub Actions: push -> avtomatik APK
docs/                         Eski loyihaning qo'shimcha hujjatlari (modellar, shaharlar haqida)
```
