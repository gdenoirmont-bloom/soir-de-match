// Soir de match · fonction serveur unique (Supabase Edge Function « soir »)
// Actions : classer, bilan, admin. L'IA est Claude, appelée avec la clé ANTHROPIC_API_KEY (secret Supabase).
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function secretKey(): string {
  try {
    const o = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (o.default) return o.default;
    const v = Object.values(o)[0];
    if (v) return v as string;
  } catch (_) { /* clés historiques */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
const db = createClient(Deno.env.get("SUPABASE_URL")!, secretKey(), { auth: { persistSession: false } });
const KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODELS = [Deno.env.get("CLAUDE_MODEL") ?? "claude-haiku-5-5", "claude-sonnet-5-5"];
const ADMIN = Deno.env.get("ADMIN_PASSWORD") ?? "paris2026";

const PARTENAIRES = ["Partenaire boisson", "Partenaire banque", "Partenaire énergie", "Partenaire automobile", "Partenaire assurance"];
const RESPONSABLES = ["Responsable event", "Responsable opérations", "Responsable accueil", "Responsable sponsoring", "Responsable billetterie"];
const SOUS = {
  "Incident": ["Sécurité", "Technique", "Propreté", "Accueil et attente"],
  "Activation partenaire": ["Faite", "Manquée", "À corriger"],
  "Idée": ["Ambiance", "Service", "Autre"],
} as Record<string, string[]>;
const URGENCES = ["Urgent", "Ce soir", "Débrief"];

async function claude(system: string, content: unknown[], maxTokens = 700): Promise<string> {
  let last = "";
  for (const model of MODELS) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
    });
    if (r.ok) {
      const j = await r.json();
      return (j.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
    }
    last = `${r.status} ${await r.text()}`;
    if (r.status !== 404 && r.status !== 400) break; // on ne réessaie qu'avec un autre modèle
  }
  throw new Error("Claude : " + last.slice(0, 300));
}

function parseJSON(t: string) {
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  return JSON.parse(t.slice(a, b + 1));
}

function b64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const SYSTEM_CLASSER = `Tu tries les signalements que le staff du Paris Basketball envoie pendant un match à l'adidas arena.
Réponds uniquement par un objet JSON, sans texte autour, avec exactement ces clés :
{"categorie": "Incident" | "Activation partenaire" | "Idée",
 "sous_categorie": pour Incident : "Sécurité" | "Technique" | "Propreté" | "Accueil et attente" ; pour Activation partenaire : "Faite" | "Manquée" | "À corriger" ; pour Idée : "Ambiance" | "Service" | "Autre",
 "partenaire": un nom exact de cette liste si le signalement le concerne, sinon null : ${JSON.stringify(PARTENAIRES)},
 "urgence": "Urgent" | "Ce soir" | "Débrief",
 "responsable": un nom exact de cette liste : ${JSON.stringify(RESPONSABLES)},
 "resume": une phrase neutre de 12 mots maximum, en français,
 "personne_visible": true si la photo montre une personne reconnaissable, sinon false,
 "masquer": true si le texte ou la photo est insultant, déplacé, ou sans aucun rapport avec un soir de match, sinon false}
Règles : n'invente rien qui ne soit ni dans la photo ni dans le texte. Urgent = sécurité des personnes ou blocage d'un flux (entrées, billetterie). Une activation partenaire va au Responsable sponsoring. Une file d'attente ou l'accueil va au Responsable accueil, sauf le contrôle des billets qui va au Responsable billetterie.`;

async function classer(id: string) {
  const { data: row, error } = await db.from("signalements").select("*").eq("id", id).single();
  if (error || !row) return json({ error: "introuvable" }, 404);
  const content: unknown[] = [];
  if (row.photo_url) {
    try {
      const img = await fetch(row.photo_url);
      const type = (img.headers.get("content-type") ?? "image/jpeg").split(";")[0];
      const bytes = new Uint8Array(await img.arrayBuffer());
      if (bytes.length < 4_500_000) content.push({ type: "image", source: { type: "base64", media_type: type, data: b64(bytes) } });
    } catch (_) { /* on classe sur le texte seul */ }
  }
  content.push({ type: "text", text: `Zone : ${row.zone ?? "non précisée"}\nRôle de la personne : ${row.role ?? "non précisé"}\nSignalement : ${row.texte || "(pas de texte, voir la photo)"}` });
  try {
    const out = parseJSON(await claude(SYSTEM_CLASSER, content, 400));
    const cat = Object.keys(SOUS).includes(out.categorie) ? out.categorie : "Incident";
    const upd = {
      analyse_ia: "ok",
      categorie: cat,
      sous_categorie: SOUS[cat].includes(out.sous_categorie) ? out.sous_categorie : SOUS[cat][SOUS[cat].length - 1],
      partenaire: PARTENAIRES.includes(out.partenaire) ? out.partenaire : null,
      urgence: URGENCES.includes(out.urgence) ? out.urgence : "Ce soir",
      responsable: RESPONSABLES.includes(out.responsable) ? out.responsable : "Responsable event",
      resume: String(out.resume ?? row.texte).slice(0, 140),
      personne_visible: out.personne_visible === true,
      masque: out.masquer === true,
    };
    await db.from("signalements").update(upd).eq("id", id);
    return json(upd);
  } catch (e) {
    await db.from("signalements").update({ analyse_ia: "echec", resume: (row.texte || "Signalement avec photo").slice(0, 140), responsable: "Responsable event", personne_visible: !!row.photo_url }).eq("id", id);
    return json({ error: String(e) }, 502);
  }
}

const SYSTEM_BILAN = `Tu rédiges le bilan d'un soir de match du Paris Basketball à partir des signalements du staff (JSON fourni).
Réponds uniquement par un objet JSON, sans texte autour :
{"partenaires": [{"partenaire": nom, "compte_rendu": texte de 80 mots maximum}],
 "responsables": [{"responsable": nom, "actions": [3 actions courtes pour le prochain match]}]}
Compte rendu partenaire : factuel, ton professionnel, ce qui a été fait, ce qui a manqué, ce qui a été corrigé, avec les heures. Prêt à envoyer après relecture.
N'invente rien : uniquement ce qui figure dans les signalements. Un partenaire ou un responsable sans signalement n'apparaît pas.`;

async function bilan() {
  const { data } = await db.from("signalements").select("created_at,zone,categorie,sous_categorie,partenaire,urgence,responsable,resume,texte,statut").order("created_at");
  if (!data?.length) return json({ partenaires: [], responsables: [] });
  const rows = data.map((r) => ({ ...r, heure: new Date(r.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }) }));
  const out = parseJSON(await claude(SYSTEM_BILAN, [{ type: "text", text: JSON.stringify(rows) }], 2500));
  return json(out);
}

const TESTS = [
  ["Le kakemono du partenaire boisson est tombé près de l'entrée.", "Parvis", "Activation partenaire", "À corriger", "Partenaire boisson", "Ce soir", "Responsable sponsoring", "Kakemono du partenaire boisson tombé à l'entrée"],
  ["Scanners de billets en panne porte B, la file s'allonge.", "Entrées", "Incident", "Technique", "", "Urgent", "Responsable billetterie", "Scanners de billets en panne porte B"],
  ["Liquide renversé dans la coursive est, risque de chute.", "Coursives", "Incident", "Sécurité", "", "Urgent", "Responsable opérations", "Liquide au sol en coursive est, risque de chute"],
  ["15 minutes d'attente à la buvette du niveau 2.", "Buvettes", "Incident", "Accueil et attente", "", "Ce soir", "Responsable accueil", "Quinze minutes d'attente à la buvette du niveau 2"],
  ["L'écran LED derrière le panier est éteint.", "Bord terrain", "Incident", "Technique", "", "Ce soir", "Responsable opérations", "Écran LED derrière le panier éteint"],
  ["Le stand du partenaire banque est vide depuis la mi-temps.", "Espace partenaires", "Activation partenaire", "Manquée", "Partenaire banque", "Ce soir", "Responsable sponsoring", "Stand du partenaire banque vide depuis la mi-temps"],
  ["Le jeu concours du partenaire énergie a bien tourné à la mi-temps.", "Tribunes", "Activation partenaire", "Faite", "Partenaire énergie", "Débrief", "Responsable sponsoring", "Jeu concours du partenaire énergie réalisé à la mi-temps"],
  ["Idée : faire chanter les tribunes pendant le temps mort.", "Tribunes", "Idée", "Ambiance", "", "Débrief", "Responsable event", "Faire chanter les tribunes pendant le temps mort"],
  ["Plus de serviettes en loge 12.", "Loges et VIP", "Incident", "Accueil et attente", "", "Ce soir", "Responsable accueil", "Plus de serviettes en loge 12"],
  ["La voiture du partenaire automobile est bien exposée sur le parvis.", "Parvis", "Activation partenaire", "Faite", "Partenaire automobile", "Débrief", "Responsable sponsoring", "Voiture du partenaire automobile exposée sur le parvis"],
  ["Poubelles pleines près de la buvette nord.", "Buvettes", "Incident", "Propreté", "", "Ce soir", "Responsable opérations", "Poubelles pleines près de la buvette nord"],
  ["Logo du partenaire assurance mal placé sur le mur des loges.", "Loges et VIP", "Activation partenaire", "À corriger", "Partenaire assurance", "Ce soir", "Responsable sponsoring", "Logo du partenaire assurance mal placé en loges"],
  ["Idée : un point eau gratuit pour les familles en tribune haute.", "Tribunes", "Idée", "Service", "", "Débrief", "Responsable event", "Point d'eau gratuit pour les familles en tribune haute"],
  ["Porte de secours bloquée par des caisses, coursive ouest.", "Coursives", "Incident", "Sécurité", "", "Urgent", "Responsable opérations", "Porte de secours bloquée par des caisses, coursive ouest"],
  ["Les hôtesses n'ont pas la liste des invités du partenaire banque.", "Entrées", "Incident", "Accueil et attente", "Partenaire banque", "Ce soir", "Responsable accueil", "Liste des invités du partenaire banque manquante à l'accueil"],
];

async function admin(body: { password?: string; op?: string }) {
  if (body.password !== ADMIN) return json({ error: "Mot de passe incorrect" }, 401);
  if (body.op === "vider") {
    await db.from("signalements").delete().not("id", "is", null);
    return json({ ok: true });
  }
  if (body.op === "injecter") {
    const now = Date.now();
    const rows = TESTS.map(([texte, zone, categorie, sous_categorie, partenaire, urgence, responsable, resume], i) => ({
      texte, zone, categorie, sous_categorie, partenaire: partenaire || null, urgence, responsable, resume,
      analyse_ia: "ok", created_at: new Date(now - (TESTS.length - i) * 90_000).toISOString(),
    }));
    const { error } = await db.from("signalements").insert(rows);
    return error ? json({ error: error.message }, 500) : json({ ok: true, n: rows.length });
  }
  return json({ error: "Opération inconnue" }, 400);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json();
    if (body.action === "classer") return await classer(body.id);
    if (body.action === "bilan") return await bilan();
    if (body.action === "admin") return await admin(body);
    return json({ error: "Action inconnue" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
