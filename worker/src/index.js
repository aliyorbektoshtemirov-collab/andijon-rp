/**
 * Andijon RP — Cloudflare Worker server.
 * Avval bu server yo'q edi (klient kodi mavjud, server kodi yo'q edi — HANDOFF.md ga qarang).
 * Bu fayl o'sha serverni noldan yozib beradi: login/ro'yxatdan o'tish, pul/mashina/rol D1'da saqlanadi,
 * tuman (district) bo'yicha bitta Durable Object — WebSocket orqali real-vaqt ko'p o'yinchili holat.
 *
 * Deploy:
 *   cd worker
 *   npx wrangler d1 create andijon-rp-db        # chiqqan database_id ni wrangler.toml ga yozing
 *   npx wrangler d1 execute andijon-rp-db --remote --file=./schema.sql
 *   npx wrangler secret put OWNER_PASS           # owner (aliyorbek) paroli — hech qayerda ochiq yozilmaydi
 *   npx wrangler deploy
 */

// Klient bilan bir xil bo'lishi SHART (server narx/katalogni o'zi biladi, klientga ishonmaydi)
const CATALOG = {
  damas:   3000, spark:   6000, nexia:  9000, cobalt: 14000, gentra: 18000,
  lacetti: 22000, onix:  30000, tracker: 40000, monza: 50000, malibu: 65000,
};
const ALL_CARS = Object.keys(CATALOG);
const OWNER_MONEY = 999999999999;
const BONUS_COOLDOWN = 20 * 60 * 60; // soniya — kunlik bonusni 20 soatdan keyin qayta olish mumkin

function nowSec() { return Math.floor(Date.now() / 1000); }
function uid(n = 8) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, n);
}
function clampNum(v, lo, hi, d = 0) {
  v = Number(v);
  if (!Number.isFinite(v)) return d;
  return Math.max(lo, Math.min(hi, v));
}
function safeStr(v, max) {
  return String(v == null ? "" : v).slice(0, max);
}

// ---- Parolni xavfsiz saqlash (PBKDF2-SHA256, Web Crypto) ----
async function hashPass(pass, saltHex) {
  const enc = new TextEncoder();
  const salt = saltHex
    ? Uint8Array.from(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)))
    : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 },
    key,
    256
  );
  const hashHex = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const saltOut = [...salt].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { hash: hashHex, salt: saltOut };
}
async function verifyPass(pass, saltHex, hashHex) {
  const { hash } = await hashPass(pass, saltHex);
  if (hash.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}

// ---- D1 yordamchilari ----
async function loadAccount(env, loginKey) {
  const row = await env.DB.prepare("SELECT * FROM accounts WHERE name = ?").bind(loginKey).first();
  if (!row) return null;
  return { ...row, cars: JSON.parse(row.cars || "[]") };
}
async function createAccount(env, loginKey, displayName, pass, district) {
  const { hash, salt } = await hashPass(pass);
  const t = nowSec();
  await env.DB.prepare(
    `INSERT INTO accounts (name, display_name, pass_hash, pass_salt, district, money, hunger, fuel, role, cars, last_bonus, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 500, 100, 50, 'fuqaro', '[]', 0, ?, ?)`
  ).bind(loginKey, displayName, hash, salt, district, t, t).run();
  return loadAccount(env, loginKey);
}
async function saveAccount(env, loginKey, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const vals = keys.map((k) => (k === "cars" ? JSON.stringify(fields[k]) : fields[k]));
  await env.DB.prepare(`UPDATE accounts SET ${sets}, updated_at = ? WHERE name = ?`)
    .bind(...vals, nowSec(), loginKey)
    .run();
}

// Joy bo'yicha ish/harakat natijalari. money/hunger/fuel ustiga QO'SHILADIGAN (delta) qiymat va javob matni.
function actionEffect(action, acc) {
  switch (action) {
    case "Zavod":
      return { money: 300, msg: "Zavodda ishladingiz: +300 so'm" };
    case "Ish bozori":
      return { money: 200, msg: "Kuryerlik qildingiz: +200 so'm" };
    case "Choyxona":
      if (acc.money < 80) return { err: "Pul yetarli emas (80 so'm kerak)" };
      return { money: -80, hunger: 100, msg: "Osh yedingiz: -80 so'm, ochlik to'ldi" };
    case "Markaziy bozor":
      if (acc.money < 30) return { err: "Pul yetarli emas (30 so'm kerak)" };
      return { money: -30, hunger: Math.min(100, acc.hunger + 25), msg: "Non oldingiz: -30 so'm" };
    case "Bank": {
      const t = nowSec();
      if (t - (acc.last_bonus || 0) < BONUS_COOLDOWN) {
        const left = Math.ceil((BONUS_COOLDOWN - (t - acc.last_bonus)) / 3600);
        return { err: `Kunlik bonusni ${left} soatdan keyin oling` };
      }
      return { money: 500, last_bonus: t, msg: "Kunlik bonus: +500 so'm" };
    }
    case "Politsiya":
      if (acc.role === "polis") return { money: 400, msg: "Patrul qildingiz: +400 so'm" };
      return { role: "polis", msg: "Siz endi politsiyachisiz" };
    case "Kasalxona":
      if (acc.role === "shifokor") return { money: 300, msg: "Navbatchilik qildingiz: +300 so'm" };
      return { role: "shifokor", msg: "Siz endi shifokorsiz" };
    case "Hokimiyat":
      return { role: "fuqaro", msg: "Siz fuqaro bo'ldingiz" };
    case "Yoqilg'i shoxobchasi":
      if (acc.money < 100) return { err: "Pul yetarli emas (100 so'm kerak)" };
      return { money: -100, fuel: 100, msg: "Benzin quyildi: +50% (-100 so'm)" };
    default:
      return { err: "Noma'lum amal" };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      const district = (url.searchParams.get("d") || "umumiy").toLowerCase().replace(/[^a-z]/g, "") || "umumiy";
      const id = env.DISTRICT.idFromName(district);
      const stub = env.DISTRICT.get(id);
      return stub.fetch(request);
    }
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("Andijon RP server ishlayapti ✅", { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  },
};

export class District {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map(); // ws -> {id, name, loginKey, x,z,ry,c,m}
    this.cars = null; // carId -> {id,mid,x,z,r,drv,own}  (loaded lazily from storage)
  }

  async ensureCars() {
    if (this.cars) return;
    const stored = (await this.state.storage.get("cars")) || {};
    this.cars = new Map(Object.entries(stored));
  }
  async saveCars() {
    await this.state.storage.put("cars", Object.fromEntries(this.cars));
  }

  broadcast(obj, exceptWs) {
    const data = JSON.stringify(obj);
    for (const ws of this.sessions.keys()) {
      if (ws === exceptWs) continue;
      try {
        ws.send(data);
      } catch (e) {
        /* o'lik socket keyingi tozalashda olib tashlanadi */
      }
    }
  }
  sendTo(ws, obj) {
    try {
      ws.send(JSON.stringify(obj));
    } catch (e) {}
  }

  async fetch(request) {
    const url = new URL(request.url);
    const district = (url.searchParams.get("d") || "umumiy").toLowerCase().replace(/[^a-z]/g, "") || "umumiy";
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }
    await this.ensureCars();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const sess = { id: uid(10), name: "", loginKey: "", x: 0, z: 0, ry: 0, c: 0, m: "" };
    this.sessions.set(server, sess);

    server.addEventListener("message", (evt) => {
      this.onMessage(server, sess, district, evt).catch(() => {
        this.sendTo(server, { t: "chat", m: "Server xatosi" });
      });
    });
    server.addEventListener("close", () => this.onClose(server, sess));
    server.addEventListener("error", () => this.onClose(server, sess));

    return new Response(null, { status: 101, webSocket: client });
  }

  onClose(ws, sess) {
    if (!this.sessions.has(ws)) return;
    this.sessions.delete(ws);
    // Agar shu sessiya mashina haydab turgan bo'lsa — mashinani bo'shatamiz
    for (const car of this.cars.values()) {
      if (car.drv === sess.id) {
        car.drv = null;
        car.x = sess.x;
        car.z = sess.z;
        car.r = sess.ry;
        this.broadcast({ t: "cupd", c: car });
      }
    }
    if (sess.loginKey) this.broadcast({ t: "leave", id: sess.id });
    this.saveCars().catch(() => {});
  }

  async onMessage(ws, sess, district, evt) {
    let m;
    try {
      m = JSON.parse(evt.data);
    } catch (e) {
      return;
    }
    const env = this.env;

    if (m.t === "auth") {
      const rawName = safeStr(m.n, 16).trim();
      const pass = safeStr(m.p, 64);
      if (rawName.length < 3 || pass.length < 4) {
        return this.sendTo(ws, { t: "auth", ok: false, err: "Ism 3+, parol 4+ belgi bo'lsin" });
      }
      const loginKey = rawName.toLowerCase();
      const isOwnerName = env.OWNER_USER && loginKey === env.OWNER_USER.toLowerCase();

      let acc = await loadAccount(env, loginKey);
      if (isOwnerName) {
        if (!env.OWNER_PASS || pass !== env.OWNER_PASS) {
          return this.sendTo(ws, { t: "auth", ok: false, err: "Parol noto'g'ri" });
        }
        if (!acc) acc = await createAccount(env, loginKey, rawName, pass, district);
        const patch = { role: "owner", money: OWNER_MONEY, cars: [...new Set([...(acc.cars || []), ...ALL_CARS])], district };
        await saveAccount(env, loginKey, patch);
        acc = { ...acc, ...patch };
      } else if (!acc) {
        acc = await createAccount(env, loginKey, rawName, pass, district);
      } else {
        const ok = await verifyPass(pass, acc.pass_salt, acc.pass_hash);
        if (!ok) return this.sendTo(ws, { t: "auth", ok: false, err: "Parol noto'g'ri" });
        if (acc.district !== district) await saveAccount(env, loginKey, { district });
      }

      sess.name = acc.display_name;
      sess.loginKey = loginKey;
      sess.x = 0;
      sess.z = -6;
      sess.ry = 0;
      sess.c = 0;
      sess.m = "";

      this.sendTo(ws, {
        t: "auth",
        ok: true,
        d: {
          district,
          money: acc.money,
          hunger: acc.hunger,
          fuel: acc.fuel,
          cars: acc.cars,
          role: acc.role,
        },
      });

      // Mavjud o'yinchilar va mashinalar ro'yxatini yangi ulanishga yuboramiz
      const players = [];
      for (const [otherWs, o] of this.sessions) {
        if (otherWs === ws || !o.loginKey) continue;
        players.push({ id: o.id, name: o.name, x: o.x, z: o.z, ry: o.ry, c: o.c, m: o.m });
      }
      this.sendTo(ws, { t: "hello", id: sess.id, players, cars: [...this.cars.values()] });
      // Boshqalarga yangi o'yinchi haqida xabar beramiz
      this.broadcast({ t: "join", p: { id: sess.id, name: sess.name, x: sess.x, z: sess.z, ry: sess.ry, c: sess.c, m: sess.m } }, ws);
      this.broadcast({ t: "chat", m: `${sess.name} tumanga keldi` });
      return;
    }

    if (!sess.loginKey) return; // auth qilinmagan sessiyadan boshqa xabarlar e'tiborga olinmaydi

    if (m.t === "pos") {
      sess.x = clampNum(m.x, -900, 900, sess.x);
      sess.z = clampNum(m.z, -1000, 900, sess.z);
      sess.ry = clampNum(m.ry, -100, 100, sess.ry);
      sess.c = m.c ? 1 : 0;
      // haydab turgan mashinasi bo'lsa shu pozitsiyani mashinaga ham yozamiz
      let drivenMid = "";
      for (const car of this.cars.values()) {
        if (car.drv === sess.id) {
          car.x = sess.x;
          car.z = sess.z;
          car.r = sess.ry;
          drivenMid = car.mid;
        }
      }
      sess.m = drivenMid;
      this.broadcast({ t: "pos", id: sess.id, n: sess.name, x: sess.x, z: sess.z, ry: sess.ry, c: sess.c, m: sess.m }, ws);
      return;
    }

    if (m.t === "chat") {
      const text = safeStr(m.m, 120).trim();
      if (!text) return;
      this.broadcast({ t: "chat", n: sess.name, m: text });
      return;
    }

    if (m.t === "buy" || m.t === "spawn") {
      const modelId = safeStr(m.id, 20);
      if (!CATALOG[modelId]) return;
      const acc = await loadAccount(env, sess.loginKey);
      if (!acc) return;
      const owns = acc.cars.includes(modelId);
      if (m.t === "buy" && !owns) {
        const price = CATALOG[modelId];
        if (acc.money < price) {
          return this.sendTo(ws, { t: "me", d: {}, m: "Pul yetarli emas" });
        }
        acc.money -= price;
        acc.cars = [...acc.cars, modelId];
        await saveAccount(env, sess.loginKey, { money: acc.money, cars: acc.cars });
        this.sendTo(ws, { t: "me", d: { money: acc.money, cars: acc.cars }, m: `Xarid qilindi: ${modelId}` });
      } else if (!owns) {
        return; // spawn so'ralgan, lekin mashina egasi emas
      }
      // shu account'ning shu modeldagi eski mashina nusxasini olib tashlab, yangisini qo'yamiz
      for (const [cid, car] of [...this.cars]) {
        if (car.own === sess.loginKey && car.mid === modelId && !car.drv) {
          this.cars.delete(cid);
          this.broadcast({ t: "cdel", id: cid });
        }
      }
      const carId = "c" + uid(8);
      const car = {
        id: carId,
        mid: modelId,
        x: clampNum(m.x, -900, 900, sess.x),
        z: clampNum(m.z, -1000, 900, sess.z),
        r: 0,
        drv: null,
        own: sess.loginKey,
      };
      this.cars.set(carId, car);
      await this.saveCars();
      this.broadcast({ t: "cadd", c: car });
      return;
    }

    if (m.t === "enter") {
      const carId = safeStr(m.car, 20);
      const car = this.cars.get(carId);
      if (!car || car.drv) return;
      if (car.own && car.own !== sess.loginKey) return; // boshqaning mashinasi
      car.drv = sess.id;
      await this.saveCars();
      this.broadcast({ t: "cupd", c: car });
      this.sendTo(ws, { t: "entered", car: carId });
      return;
    }

    if (m.t === "exit") {
      for (const car of this.cars.values()) {
        if (car.drv === sess.id) {
          car.drv = null;
          car.x = sess.x;
          car.z = sess.z;
          car.r = sess.ry;
          this.broadcast({ t: "cupd", c: car });
        }
      }
      await this.saveCars();
      return;
    }

    if (m.t === "act") {
      const action = safeStr(m.a, 40);
      const acc = await loadAccount(env, sess.loginKey);
      if (!acc) return;
      const eff = actionEffect(action, acc);
      if (eff.err) return this.sendTo(ws, { t: "me", d: {}, m: eff.err });
      const patch = {};
      if (eff.money != null) patch.money = Math.max(0, acc.money + eff.money);
      if (eff.hunger != null) patch.hunger = Math.max(0, Math.min(100, eff.hunger));
      if (eff.fuel != null) patch.fuel = Math.max(0, Math.min(100, eff.fuel));
      if (eff.role) patch.role = eff.role;
      if (eff.last_bonus) patch.last_bonus = eff.last_bonus;
      await saveAccount(env, sess.loginKey, patch);
      const d = {};
      if (patch.money != null) d.money = patch.money;
      if (patch.hunger != null) d.hunger = patch.hunger;
      if (patch.fuel != null) d.fuel = patch.fuel;
      if (patch.role) d.role = patch.role;
      this.sendTo(ws, { t: "me", d, m: eff.msg });
      return;
    }

    if (m.t === "rp") {
      const targetId = safeStr(m.to, 20);
      const acc = await loadAccount(env, sess.loginKey);
      if (!acc || (acc.role !== "polis" && acc.role !== "shifokor")) return;
      let targetWs = null,
        targetSess = null;
      for (const [w, s] of this.sessions) {
        if (s.id === targetId) {
          targetWs = w;
          targetSess = s;
          break;
        }
      }
      if (!targetWs || !targetSess) return;
      const targetAcc = await loadAccount(env, targetSess.loginKey);
      if (!targetAcc) return;
      if (acc.role === "polis") {
        const fine = Math.min(200, targetAcc.money);
        const newMoney = targetAcc.money - fine;
        await saveAccount(env, targetSess.loginKey, { money: newMoney });
        this.sendTo(targetWs, { t: "me", d: { money: newMoney }, m: `Jarima: -${fine} so'm` });
        this.sendTo(ws, { t: "me", d: {}, m: `${targetSess.name} jarimalandi` });
      } else {
        await saveAccount(env, targetSess.loginKey, { hunger: 100 });
        this.sendTo(targetWs, { t: "me", d: { hunger: 100 }, m: "Shifokor sizni davoladi" });
        this.sendTo(ws, { t: "me", d: {}, m: `${targetSess.name} davolandi` });
      }
      return;
    }
  }
}
