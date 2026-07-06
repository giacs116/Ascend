import express from 'express';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-terminal';
import { api } from './routes.js';
import { ensureIcons } from './icons.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 5252;

ensureIcons(PUBLIC);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '30mb' }));
app.use('/api', api);
app.use(express.static(PUBLIC, { index: 'index.html', extensions: false }));

// SPA fallback: any GET without a file extension serves the app shell
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api') && !path.extname(req.path)) {
    return res.sendFile(path.join(PUBLIC, 'index.html'));
  }
  next();
});

// JSON error handler (keeps the phone UI out of HTML error pages)
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

function lanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
    }
  }
  // Prefer typical home-network ranges over virtual adapters
  out.sort((a, b) => {
    const score = (x) => (x.address.startsWith('192.168.') ? 0 : x.address.startsWith('10.') ? 1 : 2);
    return score(a) - score(b);
  });
  return out;
}

const green = (s) => `\x1b[38;2;200;245;66m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

app.listen(PORT, '0.0.0.0', () => {
  const lans = lanAddresses();
  const phoneUrl = lans.length ? `http://${lans[0].address}:${PORT}` : null;

  console.log('');
  console.log(green('  ▲ ASCEND') + dim('  — your fitness companion is running'));
  console.log('');
  console.log(`  ${bold('On this PC:')}    ${green(`http://localhost:${PORT}`)}`);
  if (phoneUrl) {
    console.log(`  ${bold('On your phone:')} ${green(phoneUrl)}  ${dim('(must be on the same Wi-Fi)')}`);
    if (lans.length > 1) {
      console.log(dim(`  Other networks: ${lans.slice(1).map((l) => `http://${l.address}:${PORT}`).join('  ')}`));
    }
    console.log('');
    console.log(dim('  Scan with your phone camera:'));
    qrcode.generate(phoneUrl, { small: true });
  }
  console.log(dim('  Tip: if Windows asks about the firewall, click "Allow" for Private networks.'));
  console.log(dim('  Tip: on the phone, use the browser menu → "Add to Home Screen" to install Ascend.'));
  console.log('');
});
