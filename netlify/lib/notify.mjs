// Owner updates: the month's one-sentence summary, any alerts, and a link to the dashboard,
// by email (Resend) and text (Twilio). Owners opt in from their dashboard or staff set it up.
// Without a provider set up, messages wait in the console's outbox for staff to send by hand.
import { getJSON, setJSON, listKeys } from "./store.mjs";
import { rid } from "./http.mjs";
import { answersShort } from "./score.mjs";

export function notifySettings() {
  return {
    email: !!(process.env.RESEND_API_KEY && process.env.NOTIFY_FROM_EMAIL),
    sms: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM)
  };
}

export const cleanEmail = (v) => { const s = String(v || "").trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s.slice(0, 120) : ""; };
export function cleanPhone(v) {
  const d = String(v || "").replace(/[^\d+]/g, "");
  if (/^\+\d{10,15}$/.test(d)) return d;
  const n = d.replace(/\D/g, "");
  if (n.length === 10) return "+1" + n;
  if (n.length === 11 && n[0] === "1") return "+" + n;
  return "";
}
export function normNotify(n) {
  n = n && typeof n === "object" ? n : {};
  const phone = cleanPhone(n.phone), email = cleanEmail(n.email);
  return {
    email, phone,
    byEmail: !!(n.byEmail && email),
    byText: !!(n.byText && phone && n.textConsentAt),
    textConsentAt: n.byText && phone && n.textConsentAt ? String(n.textConsentAt).slice(0, 30) : null,
    textConsentBy: n.byText && n.textConsentAt ? (n.textConsentBy === "staff" ? "staff" : "owner") : null
  };
}

/* ---------- The message ---------- */
const TZ = "America/New_York";
const pct = (x) => (x == null ? "–" : Math.round(x * 100) + "%");
function ofTen(r) {
  if (!r || r.rate == null || !r.n) return null;
  if (r.k === 0) return "none of the";
  if (r.rate < 0.05) return "fewer than 1 of every 20";
  const n = Math.round(r.rate * 10);
  return n >= 10 ? "nearly all of the" : `about ${Math.max(1, n)} of every 10`;
}
const day = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: TZ });
const month = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "long", timeZone: TZ });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const blocked = (site) => (site?.findings || []).some((f) => /^(AI crawlers are turned away|robots\.txt blocks)/.test(f.title));

export function digest(client, audit, prev, site, prevSite, base) {
  const you = audit.summary.entities.find((e) => e.isClient), r = you.overall;
  const py = prev?.summary?.entities.find((e) => e.isClient)?.overall;
  const re = audit.kind === "recheck";
  const link = `${base}/report/#${client.shareToken}`;
  const words = ofTen(r);
  const headline = `When we asked AI on ${day(audit.createdAt)}, it named ${client.business} in ${words} answers (${pct(r.rate)}).`;
  let change = "";
  if (py && py.rate != null) {
    const when = prev.kind === "recheck" ? `your ${day(prev.createdAt)} re-check` : `the ${month(prev.createdAt)} measurement`;
    change = r.low > py.high ? `That’s up from ${pct(py.rate)} in ${when}, a real gain.`
      : r.high < py.low ? `That’s down from ${pct(py.rate)} in ${when}, a real drop.`
      : `That’s about the same as ${when} (${pct(py.rate)}).`;
  }
  const alerts = [];
  const phones = audit.summary.accuracy?.phoneIssues?.length || 0;
  if (phones) alerts.push(`AI gave a wrong phone number for you in ${phones} answer${phones === 1 ? "" : "s"}. Your dashboard shows which answers, and what to correct.`);
  if (blocked(site) && prevSite && !blocked(prevSite)) alerts.push("Your website started turning away at least one AI assistant. Your dashboard shows which one; whoever manages your site can change the setting.");
  if (prev) {
    const prevBy = Object.fromEntries((prev.summary.entities || []).map((e) => [e.id, e.overall]));
    const pyo = prevBy[you.id];
    for (const c of audit.summary.entities.filter((e) => !e.isClient)) {
      const was = prevBy[c.id];
      const aheadNow = c.overall.low > r.high, aheadBefore = was && pyo ? was.low > pyo.high : false;
      if (aheadNow && !aheadBefore) alerts.push(`${c.name} is now named clearly more often than you.`);
    }
  }
  const working = (client.plan || []).filter((p) => p.status === "doing").slice(0, 3).map((p) => p.title);
  const subject = re ? `Your early re-check is in: ${words} answers` : `Your ${month(audit.createdAt)} AI visibility: ${words} answers`;
  const sms = [`207 Visibility: ${re ? "Your re-check is in. " : ""}${headline}`, change, alerts[0] ? `Heads up: ${alerts[0]}` : "", `See it: ${link}`, "Reply STOP to opt out."].filter(Boolean).join(" ");
  const text = [headline, change, "", ...(alerts.length ? ["Heads up:", ...alerts.map((a) => `- ${a}`), ""] : []),
    ...(working.length ? ["Steps in progress:", ...working.map((w) => `- ${w}`), ""] : []),
    `Your dashboard, with every AI answer: ${link}`, "", "207 Visibility · Maine-owned. Maine-run."].join("\n");
  const unsub = `${base}/api/share?t=${encodeURIComponent(client.shareToken)}&unsubscribe=email`;
  const html = `<!doctype html><html><body style="margin:0;background:#F3F6FB;font-family:Helvetica,Arial,sans-serif;color:#27344E">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F6FB;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#001536;color:#fff;padding:18px 24px;font-weight:bold;font-size:15px">207 Visibility <span style="color:#A9B8D6;font-weight:normal">· ${esc(client.business)}</span></td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#58657F">${re ? "Early re-check" : esc(month(audit.createdAt)) + " measurement"}</p>
<p style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:bold;color:#091A35">${esc(headline)}</p>
${change ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.5">${esc(change)}</p>` : ""}
${alerts.length ? `<div style="background:#FBEFDA;border-radius:8px;padding:12px 14px;margin:0 0 16px"><p style="margin:0 0 6px;font-weight:bold;color:#965700">Heads up</p>${alerts.map((a) => `<p style="margin:4px 0;font-size:14px">${esc(a)}</p>`).join("")}</div>` : ""}
${working.length ? `<p style="margin:0 0 6px;font-weight:bold;color:#091A35">Steps in progress</p><ul style="margin:0 0 18px;padding-left:18px;font-size:14px;line-height:1.6">${working.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
<p style="margin:18px 0"><a href="${esc(link)}" style="background:#014FE5;color:#fff;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:8px;display:inline-block">Open your dashboard</a></p>
<p style="margin:0;font-size:13px;color:#58657F">Every number on your dashboard comes with the actual AI answers behind it.</p>
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #E1E7F0;font-size:12px;color:#8793A8">207 Visibility · Maine-owned. Maine-run. · <a href="${esc(unsub)}" style="color:#8793A8">Stop these emails</a></td></tr>
</table></td></tr></table></body></html>`;
  return { subject, sms, text, html, unsub, alerts };
}

/* ---------- Sending ---------- */
export async function sendEmail(to, msg) {
  const reply = cleanEmail(process.env.CONTACT_EMAIL);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: process.env.NOTIFY_FROM_EMAIL, to: [to], subject: msg.subject, html: msg.html, text: msg.text,
      reply_to: reply || undefined, headers: msg.unsub ? { "List-Unsubscribe": `<${msg.unsub}>` } : undefined })
  });
  if (!res.ok) throw new Error(`Email: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}
async function sendSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID, from = process.env.TWILIO_FROM;
  const form = new URLSearchParams({ To: to, Body: body });
  form.set(from.startsWith("MG") ? "MessagingServiceSid" : "From", from);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: form.toString()
  });
  if (!res.ok) throw new Error(`Text: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}

// Sends to every channel the owner has switched on. Each message is logged in the outbox;
// with no provider set up it waits there as "queued" for staff to send by hand.
// One message on one channel, logged in the client's outbox. Without a provider it waits there as "queued".
export async function sendOne(client, channel, to, msg, meta = {}) {
  const st = notifySettings(), ready = channel === "email" ? st.email : st.sms;
  const now = new Date().toISOString();
  const rec = { id: `${now.slice(0, 10)}-${rid(6)}`, clientId: client.id, channel, to, subject: msg.subject, text: channel === "sms" ? msg.sms : msg.text,
    html: channel === "email" ? msg.html : undefined, createdAt: now, reason: meta.reason || "manual", auditKey: meta.auditKey || null, status: "queued" };
  if (ready) {
    try { if (channel === "email") await sendEmail(to, msg); else await sendSms(to, msg.sms); rec.status = "sent"; rec.sentAt = new Date().toISOString(); }
    catch (e) { rec.status = "failed"; rec.error = String(e.message).slice(0, 300); }
  }
  await setJSON("outbox", `${client.id}/${rec.id}`, rec);
  return rec;
}

export async function deliver(client, msg, meta = {}) {
  const n = normNotify(client.notify), out = [];
  if (n.byEmail) out.push(await sendOne(client, "email", n.email, msg, meta));
  if (n.byText) out.push(await sendOne(client, "sms", n.phone, msg, meta));
  return out;
}

// A short email to the founder (ALERT_EMAIL, or CONTACT_EMAIL) about a sign-up or an audit to review.
// Quietly does nothing until email sending is set up; the console shows the same things.
export async function alertFounder(subject, lines, link) {
  const to = cleanEmail(process.env.ALERT_EMAIL || process.env.CONTACT_EMAIL);
  if (!to || !notifySettings().email) return false;
  const text = [...lines, "", link ? `Open the console: ${link}` : ""].join("\n").trim();
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;color:#27344E;font-size:15px;line-height:1.5">${lines.map((l) => `<p style="margin:0 0 8px">${esc(l)}</p>`).join("")}${link ? `<p style="margin:16px 0 0"><a href="${esc(link)}">Open the console</a></p>` : ""}</div>`;
  try { await sendEmail(to, { subject: `207 Visibility: ${subject}`, text, html }); return true; }
  catch (e) { console.log("founder alert failed", e.message); return false; }
}

// The latest complete measurement before this one, and both site checks.
export async function contextFor(audit) {
  const keys = await listKeys("audits", `${audit.clientId}/`);
  const prev = (await Promise.all(keys.map((k) => getJSON("audits", k))))
    .filter((a) => a && a.key !== audit.key && a.status === "complete" && a.summary && a.createdAt < audit.createdAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
  const site = (await getJSON("answers", `${audit.key}/site`))?.site || {};
  const prevSite = prev ? (await getJSON("answers", `${prev.key}/site`))?.site || {} : null;
  return { prev, site, prevSite };
}

// Called when an audit finishes. Monthly audits and early re-checks send the owner their
// summary (only once per audit); audits staff start by hand don't, so testing stays quiet.
export async function afterAudit(audit, base = process.env.URL || "") {
  // A paid sign-up's first audit goes to the founder for review, never straight to the owner.
  if (audit.source === "signup") {
    const client = await getJSON("clients", audit.clientId);
    if (!client || (await getJSON("notifications", `review/${audit.key}`))) return null;
    await setJSON("notifications", `review/${audit.key}`, { at: new Date().toISOString() });
    const short = answersShort(audit);
    await alertFounder(short ? `an audit needs you: ${client.business}` : `ready for review: ${client.business}`, short ? [
      `The first audit for ${client.business} (${client.trade}, ${client.town}) finished, but only ${short.got} of ${short.expected} questions got an answer. A platform was probably having trouble.`,
      "Open the audit and press Retry on each platform that came up short before you review it. Don’t release it like this: the numbers would be built on too few answers."
    ] : [
      `The first audit for ${client.business} (${client.trade}, ${client.town}) has finished.`,
      "Check it, build the plan with Suggest from latest audit, then press Release to owner to email them their dashboard."
    ], `${base}/admin/#client/${client.id}`);
    return null;
  }
  if (!(audit.kind === "recheck" || audit.source === "monthly")) return null;
  const client = await getJSON("clients", audit.clientId);
  if (!client) return null;
  const n = normNotify(client.notify);
  if (!n.byEmail && !n.byText) return null;
  if (await getJSON("notifications", audit.key)) return null;
  const claim = rid(8);
  await setJSON("notifications", audit.key, { at: new Date().toISOString(), claim });
  if ((await getJSON("notifications", audit.key))?.claim !== claim) return null; // another worker got here first
  const { prev, site, prevSite } = await contextFor(audit);
  return deliver(client, digest(client, audit, prev, site, prevSite, base), { reason: audit.kind === "recheck" ? "recheck" : "monthly", auditKey: audit.key });
}
