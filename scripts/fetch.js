// scripts/fetch.js — CommonJS, zero deps, resilient
const fs = require("fs/promises");

// Tiny fetch helpers with timeout + UA (some sites dislike default UA)
async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000);
  try {
    const r = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        "user-agent": "hr-law-updates-bot/1.0 (+github actions)",
        accept: opts.accept || "*/*",
        ...(opts.headers || {})
      }
    });
    return r;
  } finally {
    clearTimeout(t);
  }
}
async function getJson(url) {
  const r = await fetchWithTimeout(url, { accept: "application/json" });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.json();
}
async function getText(url) {
  const r = await fetchWithTimeout(url);
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
function safeLog(label, e) {
  console.error(`[${label}]`, e?.message || e);
}

// ---------- Sources (each wrapped in try/catch) ----------
async function pullNYCCouncil() {
  try {
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
  } catch (e) {
    safeLog("NYC Council", e);
    return [];
  }
}

async function pullNYCRules() {
  try {
    const q = encodeURIComponent("employment OR labor OR wage OR sick OR leave OR retaliation OR schedule");
    const html = await getText(`https://rules.cityofnewyork.us/?s=${q}`);
    const text = stripHtml(html);
    const chunks = text
      .split(/(?=Read More|Proposed Rule|Adopted Rule|Not
