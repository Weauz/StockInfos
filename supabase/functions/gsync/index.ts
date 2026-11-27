// StockInfos : synchro des chantiers avec Google Agenda, faite par le serveur.
// Tourne toutes les 30 s et juste après chaque changement de chantier : le PC et le téléphone peuvent être éteints.
// Les chantiers sont dans public.si_items (kind = 'event'). Le PC ou le téléphone calcule le texte envoyé à Google
// (champ data.gb) ; ici on ne fait que comparer et recopier dans les deux sens.

const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GAPI = "https://www.googleapis.com/calendar/v3";
const DEVICE = "Google Agenda";

type Row = { kind: string; id: string; data: any; deleted: boolean; updated_at: string };

async function sb(method: string, path: string, body?: unknown, prefer?: string) {
  const r = await fetch(SB + "/rest/v1/" + path, {
    method,
    headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json", "x-si-device": DEVICE, ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  let j: any = null;
  try { j = t ? JSON.parse(t) : null; } catch { /* */ }
  if (r.status >= 300) throw new Error("base " + r.status + " " + t.slice(0, 200));
  return j;
}

// ---- mêmes règles que dans l'appli ----
const pad = (n: number) => String(n).padStart(2, "0");
const add = (s: string, n: number) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); };
function htmlToText(h: string) {
  if (!/<[a-z][\s\S]*>/i.test(h)) return h;
  return h.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d)>/gi, "\n").replace(/<li[^>]*>/gi, "- ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, "\n\n").trim();
}
function hashId(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return "g" + (h >>> 0).toString(36); }
function gToLocal(it: any) {
  const S0 = it.start || {}, E0 = it.end || {};
  let start: string, end: string, t0 = "", t1 = "";
  if (S0.date) { start = S0.date; end = E0.date ? add(E0.date, -1) : start; }
  else if (S0.dateTime) {
    start = S0.dateTime.slice(0, 10); t0 = S0.dateTime.slice(11, 16);
    if (E0.dateTime) { end = E0.dateTime.slice(0, 10); t1 = E0.dateTime.slice(11, 16); if (t1 === "00:00" && end > start) { end = add(end, -1); t1 = ""; } } else end = start;
  } else return null;
  if (end < start) end = start;
  return { title: it.summary || "(Sans titre)", start, end, t0, t1, lieu: it.location || "", desc: htmlToText(it.description || "") };
}
const vis = (it: any) => { const f = gToLocal(it); return f ? hashId(JSON.stringify(f)) : ""; };
const stripDesc = (d: string) => String(d || "").replace(/^Matériel :\n(?:- .*(?:\n|$))*/, "").replace(/^\s*Démontage : .*(?:\n|$)/, "").replace(/\n*— Envoyé par StockInfos\s*$/, "").trim();
function readJ(it: any) {
  const pr = (it.extendedProperties && it.extendedProperties.private) || {};
  let j = ""; for (let k = 0; pr["j" + k] !== undefined; k++) j += pr["j" + k];
  if (j) { try { return JSON.parse(j); } catch { /* */ } }
  const f: any = gToLocal(it); if (!f) return null; f.desc = stripDesc(f.desc); return f;
}
const gTitle = (t: string) => String(t || "").replace(/^Montage · /, "");
const DM = "~dm"; // un chantier avec démontage séparé a un 2e événement dans Google, marqué <id>~dm
const si = (it: any) => it.extendedProperties && it.extendedProperties.private && it.extendedProperties.private.si;
const gbHash = (gb: any) => gb && gb.extendedProperties && gb.extendedProperties.private && gb.extendedProperties.private.h;
const syncable = (d: any) => d && d.src === "manuel" && !d.essai;
// comparaison indépendante de l'ordre des champs (la base les range à sa façon)
const stable = (v: any): string => v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? "[" + v.map(stable).join(",") + "]" : "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";

async function token(a: any) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: a.client_id, client_secret: a.client_secret, refresh_token: a.refresh, grant_type: "refresh_token" }).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Google : " + (j.error || r.status) + (j.error_description ? " (" + j.error_description + ")" : ""));
  return j.access_token as string;
}

async function run(a: any): Promise<string> {
  const tok = await token(a);
  const g = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(GAPI + path, { method, headers: { Authorization: "Bearer " + tok, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { /* */ }
    if (r.status >= 400 && r.status !== 404 && r.status !== 410) throw new Error("Google " + r.status + " : " + ((j && j.error && j.error.message) || t.slice(0, 150)));
    return { status: r.status, json: j };
  };

  // 1. l'agenda « Chantiers StockInfos »
  let cal: string | null = a.cal || null;
  if (cal) { const r = await g("GET", "/calendars/" + encodeURIComponent(cal)); if (r.status === 404 || r.status === 410) cal = null; }
  if (!cal) {
    const L = await g("GET", "/users/me/calendarList?minAccessRole=owner&maxResults=250");
    const c = ((L.json && L.json.items) || []).find((c: any) => /chantiers stockinfos/i.test(c.summary || "") || /Chantiers créés dans StockInfos/.test(c.description || ""));
    if (c) cal = c.id;
    else { const r = await g("POST", "/calendars", { summary: "Chantiers StockInfos", description: "Chantiers créés dans StockInfos", timeZone: "Europe/Paris" }); cal = r.json.id; }
  }
  const base = "/calendars/" + encodeURIComponent(cal!) + "/events";

  // 2. ce qu'il y a dans Google
  const items: any[] = []; let pt = "";
  do {
    const r = await g("GET", base + "?maxResults=2500&showDeleted=false" + (pt ? "&pageToken=" + encodeURIComponent(pt) : ""));
    if (r.status !== 200) throw new Error("agenda illisible");
    items.push(...((r.json && r.json.items) || []).filter((it: any) => it.status !== "cancelled" && it.start));
    pt = r.json && r.json.nextPageToken;
  } while (pt);
  const bySi = new Map<string, any>(), byGid = new Map<string, any>();
  for (const it of items) { byGid.set(it.id, it); const s = si(it); if (s && !bySi.has(s)) bySi.set(s, it); }
  const used = new Set<string>();

  // 3. ce qu'il y a dans la base
  const rows: Row[] = (await sb("GET", "si_items?kind=eq.event&select=kind,id,data,deleted,updated_at")) || [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const upd = async (r: Row, data: any, deleted = false) => {
    await sb("PATCH", `si_items?kind=eq.event&id=eq.${encodeURIComponent(r.id)}&updated_at=eq.${encodeURIComponent(r.updated_at)}`, { data, deleted }, "return=minimal");
  };
  let nA = 0, nU = 0, nD = 0, nI = 0;

  for (const r of rows) {
    if (r.deleted || !syncable(r.data)) continue;
    const d = r.data, it = bySi.get(r.id) || (d.gid ? byGid.get(d.gid) : null), lh = gbHash(d.gb);
    let nd: any = { ...d }, gone = false; // les changements s'accumulent puis sont écrits en une fois
    if (it) {
      used.add(it.id);
      const vr = vis(it), remoteChanged = !!d.gv && vr !== d.gv, localChanged = !!d.gb && lh !== d.gh;
      if (localChanged) {
        const p = await g("PATCH", base + "/" + encodeURIComponent(it.id), d.gb);
        if (p.status < 300) { nd = { ...nd, gid: it.id, gh: lh, gv: vis(p.json || d.gb), gcal: cal }; nU++; }
      } else if (remoteChanged) {
        const f: any = gToLocal(it);
        if (f) { nd = { ...nd, title: gTitle(f.title), start: f.start, end: f.end, t0: f.t0, t1: f.t1, lieu: f.lieu, desc: stripDesc(f.desc), gid: it.id, gv: vr, gcal: cal }; nI++; }
      } else if (!d.gv || d.gid !== it.id || d.gcal !== cal) { nd = { ...nd, gid: it.id, gv: vr, gcal: cal }; }
    } else if (d.gid && d.gcal === cal) {
      gone = true; nI++; // supprimé dans Google
    } else if (d.gb) {
      const p = await g("POST", base, d.gb);
      nd = { ...nd, gid: p.json.id, gh: lh, gv: vis(p.json), gcal: cal }; nA++;
    }
    // le démontage (2e événement)
    if (!gone) {
      const itd = bySi.get(r.id + DM) || (d.gidd ? byGid.get(d.gidd) : null), lhd = gbHash(d.gbd);
      if (itd) used.add(itd.id);
      if (d.gbd) {
        if (itd) {
          const vr = vis(itd);
          if (lhd !== d.ghd) {
            const p = await g("PATCH", base + "/" + encodeURIComponent(itd.id), d.gbd);
            if (p.status < 300) { nd = { ...nd, gidd: itd.id, ghd: lhd, gvd: vis(p.json || d.gbd) }; nU++; }
          } else if (d.gvd && vr !== d.gvd) {
            const f: any = gToLocal(itd);
            if (f) { nd = { ...nd, dm: { start: f.start, end: f.end, t0: f.t0, t1: f.t1 }, gidd: itd.id, gvd: vr }; nI++; }
          } else if (!d.gvd || d.gidd !== itd.id) { nd = { ...nd, gidd: itd.id, gvd: vr }; }
        } else if (d.gidd && d.gcal === cal) {
          nd = { ...nd, dm: { tbd: 1 } }; delete nd.gidd; delete nd.ghd; delete nd.gvd; nI++; // démontage supprimé dans Google : date à redéfinir
        } else {
          const p = await g("POST", base, d.gbd);
          nd = { ...nd, gidd: p.json.id, ghd: lhd, gvd: vis(p.json) }; nA++;
        }
      } else if (itd) {
        await g("DELETE", base + "/" + encodeURIComponent(itd.id)); nD++;
        delete nd.gidd; delete nd.ghd; delete nd.gvd;
      } else if (d.gidd) { delete nd.gidd; delete nd.ghd; delete nd.gvd; }
    }
    if (gone) await upd(r, {}, true);
    else if (stable(nd) !== stable(d)) await upd(r, nd);
  }
  // supprimé dans l'appli : on l'enlève aussi de Google
  for (const r of rows) {
    if (!r.deleted) continue;
    const it = bySi.get(r.id) || (r.id.startsWith("gs") ? byGid.get(r.id.slice(2)) : null);
    if (it && !used.has(it.id)) { used.add(it.id); await g("DELETE", base + "/" + encodeURIComponent(it.id)); nD++; }
    const itd = bySi.get(r.id + DM);
    if (itd && !used.has(itd.id)) { used.add(itd.id); await g("DELETE", base + "/" + encodeURIComponent(itd.id)); nD++; }
  }
  // nouveaux dans Google (créés directement dans l'agenda, ou anciens chantiers absents de la base)
  const ins: any[] = [];
  for (const it of items) {
    if (used.has(it.id)) continue;
    const s = si(it);
    if (s && s.endsWith(DM)) { // démontage dont le chantier n'existe plus dans la base
      if (!byId.has(s.slice(0, -DM.length))) { await g("DELETE", base + "/" + encodeURIComponent(it.id)); nD++; }
      continue;
    }
    if (s) {
      if (byId.has(s)) continue;
      const d = readJ(it); if (!d) continue;
      ins.push({ kind: "event", id: s, deleted: false, data: { ...d, man: d.man || { packs: {}, items: {} }, id: s, src: "manuel", gid: it.id, gh: it.extendedProperties.private.h, gv: vis(it), gcal: cal, created: Date.now() } });
    } else {
      const id = "gs" + it.id; if (byId.has(id)) continue;
      const f: any = gToLocal(it); if (!f) continue; f.desc = stripDesc(f.desc);
      ins.push({ kind: "event", id, deleted: false, data: { ...f, id, src: "manuel", gid: it.id, gcal: cal, gh: "", gv: vis(it), ci: 3, created: Date.now(), man: { packs: {}, items: {} } } });
    }
  }
  if (ins.length) { await sb("POST", "si_items?on_conflict=kind,id", ins, "resolution=ignore-duplicates,return=minimal"); nI += ins.length; }

  // état visible dans l'appli (écrit seulement s'il change)
  const st = byId.get("gserver");
  const want = { name: "Synchro Google", on: true, cal, email: a.email || "" };
  const cur = (await sb("GET", "si_items?kind=eq.setting&id=eq.gserver&select=data,deleted"))?.[0];
  if (!cur || cur.deleted || stable(cur.data) !== stable(want)) {
    await sb("POST", "si_items?on_conflict=kind,id", [{ kind: "setting", id: "gserver", data: want, deleted: false }], "resolution=merge-duplicates,return=minimal");
  }
  void st;
  console.log(`synchro ok : ${nA} envoyés, ${nU} mis à jour, ${nD} retirés, ${nI} reçus`);
  return cal!;
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-si-cron") || "";
  let begin: any;
  try { begin = await sb("POST", "rpc/si_gsrv_begin", { p_secret: secret }); }
  catch (e) { return new Response(String(e), { status: 500 }); }
  if (!begin || !begin.ok) return new Response(JSON.stringify(begin), { status: begin && begin.why === "secret" ? 401 : 200 });
  let err: string | null = null, cal: string | null = null;
  for (let pass = 0; pass < 3; pass++) {
    try { cal = await run(begin); err = null; } catch (e) { err = String((e as Error).message || e).slice(0, 300); console.error(err); }
    const again = await sb("POST", "rpc/si_gsrv_end", { p_err: err, p_cal: cal });
    if (!again || err) break;
    const b2 = await sb("POST", "rpc/si_gsrv_begin", { p_secret: secret }); if (!b2 || !b2.ok) break; begin = b2;
  }
  if (err) {
    // l'erreur s'affiche dans Paramètres sur le PC et le téléphone
    const want = { name: "Synchro Google", on: !/invalid_grant/i.test(err), cal: begin.cal || null, email: begin.email || "", err: /invalid_grant/i.test(err) ? "Accès Google expiré : reconnecte Google sur le PC puis réactive la synchro serveur" : err };
    try {
      const cur = (await sb("GET", "si_items?kind=eq.setting&id=eq.gserver&select=data,deleted"))?.[0];
      if (!cur || stable(cur.data) !== stable(want)) await sb("POST", "si_items?on_conflict=kind,id", [{ kind: "setting", id: "gserver", data: want, deleted: false }], "resolution=merge-duplicates,return=minimal");
    } catch { /* */ }
  }
  return new Response(JSON.stringify({ ok: !err, err }), { headers: { "Content-Type": "application/json" } });
});
