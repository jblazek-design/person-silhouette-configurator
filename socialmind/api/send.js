// Vercel serverless function: emails the generated pack (PNG attachments) through Resend.
// Env vars (Vercel → Project → Settings → Environment Variables):
//   RESEND_API_KEY  required — from resend.com (or the Resend integration in the Vercel Marketplace)
//   MAIL_FROM       sender, e.g. "Socialmind <hello@socialmind.cz>" (domain must be verified in Resend).
//                   Default: hello@RESEND_EMAIL_DOMAIN (domain provisioned by the Vercel integration),
//                   else onboarding@resend.dev, which only delivers to the Resend account owner.
//   MAIL_BCC        optional — a copy of every mail, handy for collecting leads
const MAX_ATTACH_CHARS = 4 * 1024 * 1024; // base64 characters across all attachments (~3 MB)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FILE_RE = /^[a-z0-9][a-z0-9._-]{0,60}\.png$/i;

const senderDefault = () => process.env.MAIL_FROM
  || (process.env.RESEND_EMAIL_DOMAIN ? `Socialmind <hello@${process.env.RESEND_EMAIL_DOMAIN}>` : 'Socialmind <onboarding@resend.dev>');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const key = process.env.RESEND_API_KEY;
  // GET = health check (no secrets): is mail configured and which sender is used
  if (req.method === 'GET') return res.status(200).json({ configured: !!key, from: key ? senderDefault() : null });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!key) return res.status(503).json({ error: 'Email isn\'t set up on this server yet.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Bad request' });
  const { email, name, files, website } = body;
  if (website) return res.status(200).json({ ok: true }); // honeypot filled → pretend success, send nothing
  if (typeof email !== 'string' || email.length > 254 || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email address' });
  if (!Array.isArray(files) || !files.length || files.length > 6) return res.status(400).json({ error: 'No files' });

  const attachments = [];
  let total = 0;
  for (const f of files) {
    if (!f || typeof f.name !== 'string' || typeof f.content !== 'string' || !FILE_RE.test(f.name)) return res.status(400).json({ error: 'Bad file' });
    total += f.content.length;
    if (total > MAX_ATTACH_CHARS) return res.status(413).json({ error: 'Files too large' });
    attachments.push({ filename: f.name, content: f.content });
  }

  const from = senderDefault();
  const safeName = String(name || '').slice(0, 60).replace(/[<>&"']/g, '');
  const payload = {
    from,
    to: [email],
    subject: 'Your Socialmind character',
    html: `<p>Hi${safeName ? ' ' + safeName : ''},</p>` +
      '<p>your character is attached: story (9:16), post (1:1) and the character on its own. Share it wherever you like.</p>' +
      '<p>Made with <a href="https://characters-factory.vercel.app">Characters factory</a> by Socialmind.</p>',
    attachments
  };
  if (process.env.MAIL_BCC) payload.bcc = [process.env.MAIL_BCC];

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    console.error('resend', r.status, await r.text());
    return res.status(502).json({ error: 'Sending failed, please try again later.' });
  }
  return res.status(200).json({ ok: true });
};
