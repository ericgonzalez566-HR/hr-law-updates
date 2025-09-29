// scripts/fetch.js
import fs from "node:fs/promises";

// simple helpers
async function getJson(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.json();
}
async function getText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.text();
}
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function item({ id, source, title, date, url, tags = [] }) {
  return { id, source, title, date, url, tags };
}

// NYC Council (Legistar API)
async function pullNYCCouncil() {
  const url = "https://webapi.legistar.com/v1/nyc/Matters?$orderby=LastModifiedUtc%20desc&$top=25";
  const data = await getJson(url);
  const keys = ["employment","labor","wage","salary","sick","safe","leave","retaliation","schedule","pay","overtime"];

  return data
    .filter(m => {
      const blob = [
        m.MatterName, m.MatterTitle, m.MatterTypeName,
        m.MatterStatusName, m.MatterBodyName, m.MatterFile
      ].join(" ").toLowerCase();
      return keys.some(k => blob.includes(k));
    })
    .map(m => item({
      id: `nycc-${m.MatterId}`,
      source: "NYC Council",
      title: m.MatterTitle || m.MatterName || m.MatterFile,
      date: m.LastModifiedUtc || m.MatterIntroDate || new Date().toISOString(),
      url: m.MatterHyperlink || `https://legistar.council.nyc.gov/LegislationDetail.aspx?ID=${m.MatterId}`,
      tags: ["NYC"]
    }));
}

// NYC Rules (simple text scrape)
async function pullNYCRules() {
  const q = encodeURIComponent("employment OR labor OR wage OR sick OR leave OR retaliation OR schedule");
  const html = await getText(`https://rules.cityofnewyork.us/?s=${q}`);
  const text = stripHtml(html);
  const chunks = text.split(/(?=Read More|Proposed Rule|Adopted Rule|Notice of Public Hearing)/i).slice(0, 15);

  return chunks.map((t, i) => item({
    id: `nycr-${Date.now()}-${i}`,
    source: "NYC Rules",
    title: t.slice(0, 140) + "…",
    date: new Date().toISOString(),
    url: "https://rules.cityofnewyork.us/",
    tags: ["NYC","Rules"]
  }));
}

// City Record
async function pullCityRecord() {
  const html = await getText("https://a856-cityrecord.nyc.gov/");
  const text = stripHtml(html);
  const lines = text
    .split(/\n|\.\s+/)
    .filter(line => /DCWP|DCA|DOL|work|wage|employment|labor|sick|leave|retaliation|schedule/i.test(line))
    .slice(0, 10);

  return lines.map((t, i) => item({
    id: `crol-${Date.now()}-${i}`,
    source: "City Record",
    title: t.slice(0, 140) + "…",
    date: new Date().toISOString(),
    url: "https://a856-cityrecord.nyc.gov/",
    tags: ["NYC","Notices"]
  }));
}

// NYS Register
async function pullNYSRegister() {
  const html = await getText("https://dos.ny.gov/state-register");
  const text = stripHtml(html);
  const lines = text
    .split(/\n|\.\s+/)
    .filter(line => /labor|employment|wage|salary|sick|leave|retaliation|schedule|minimum wage/i.test(line))
    .slice(0, 10);

  return lines.map((t, i) => item({
    id: `nysr-${Date.now()}-${i}`,
    source: "NYS Register",
    title: t.slice(0, 140) + "…",
    date: new Date().toISOString(),
    url: "https://dos.ny.gov/state-register",
    tags: ["NYS","Rulemaking"]
  }));
}

// NYS DOL
async function pullNYSDOL() {
  const html = await getText("https://dol.ny.gov/");
  const text = stripHtml(html);
  const lines = text
    .split(/\n|\.\s+/)
    .filter(line => /news|press|wage|overtime|salary transparency|leave|retaliation|work/i.test(line))
    .slice(0, 8);

  return lines.map((t, i) => item({
    id: `nysdol-${Date.now()}-${i}`,
    source: "NYS DOL",
    title: t.slice(0, 140) + "…",
    date: new Date().toISOString(),
    url: "https://dol.ny.gov/",
    tags: ["NYS","Guidance"]
  }));
}

(async () => {
  try {
    const all = [
      ...(await pullNYCCouncil()).slice(0, 15),
      ...(await pullNYCRules()),
      ...(await pullCityRecord()),
      ...(await pullNYSRegister()),
      ...(await pullNYSDOL()),
    ];

    // de-dupe and sort
    const seen = new Set();
    const deduped = [];
    for (const it of all) {
      const key = `${it.source}::${it.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(it);
    }
    deduped.sort((a,b) => new Date(b.date) - new Date(a.date));

    await fs.writeFile("updates.json", JSON.stringify(deduped, null, 2));
    console.log(`Wrote updates.json with ${deduped.length} items`);
  } catch (e) {
    console.error("Failed to build updates.json:", e);
    process.exitCode = 1;
  }
})();
