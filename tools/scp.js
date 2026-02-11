// Filament-Sync/tools/scp.js
//
// Dropbear-friendly uploader: NO SFTP required.
// Uploads files via SSH exec + stdin (cat > file), with atomic temp+mv.
//
// Compatible with BOTH config styles:
//   - PRINTERIP / USER / PASSWORD  (as in Filament-Sync README)
//   - PRINTER_IP / PRINTER_USER / PRINTER_PASSWORD (alt style)

const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

let cfg = {};
try {
  // user-config.js lives at repo root
  cfg = require('../user-config');
} catch {
  cfg = {};
}

// Optional debug logging: set FILAMENT_SYNC_DEBUG=1
const DEBUG =
  process.env.FILAMENT_SYNC_DEBUG === '1' ||
  process.env.FILAMENT_SYNC_DEBUG === 'true';

const log = (...args) => console.log('[Filament-Sync][upload]', ...args);
const dlog = (...args) => {
  if (DEBUG) log(...args);
};

const pickFirst = (...vals) => {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
};

const shQuote = (s) => {
  // Strong single-quote escaping for sh.
  // ' -> '\''  (close quote, escape, reopen)
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
};

const getPrinterParams = () => {
  const host = pickFirst(
    process.env.PRINTER_IP,
    process.env.PRINTERIP,
    cfg.PRINTER_IP,
    cfg.PRINTERIP,
    cfg.PRINTER_HOST,
    cfg.PRINTERHOST,
    cfg.PRINTER
  );

  const username = pickFirst(
    process.env.PRINTER_USER,
    process.env.PRINTERUSER,
    cfg.PRINTER_USER,
    cfg.USER,
    cfg.USERNAME
  ) || 'root';

  const password = pickFirst(
    process.env.PRINTER_PASSWORD,
    process.env.PRINTERPASS,
    cfg.PRINTER_PASSWORD,
    cfg.PASSWORD,
    cfg.PASS
  );

  const portStr = pickFirst(
    process.env.PRINTER_PORT,
    cfg.PRINTER_PORT,
    cfg.PORT
  );
  const port = portStr ? Number(portStr) : 22;

  // Where Filament-Sync-Service watches on the printer
  const remoteDir = pickFirst(
    process.env.PRINTER_SYNC_DIR,
    process.env.REMOTE_DIR,
    cfg.PRINTER_SYNC_DIR,
    cfg.REMOTE_DIR,
    cfg.SYNCDIRECTORY
  ) || '/usr/share/Filament-Sync';

  return { host, port, username, password, remoteDir };
};

const connectSSH = ({ host, port, username, password }) => {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    conn
      .on('ready', () => resolve(conn))
      .on('error', (err) => reject(err))
      .connect({
        host,
        port: port || 22,
        username,
        password,
        // Dropbear can be picky; keepalive helps stability on some networks
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
        readyTimeout: 20000,
      });
  });
};

const execWithStdin = (conn, command, stdinBuffer) => {
  return new Promise((resolve, reject) => {
    dlog('exec:', command);

    conn.exec(command, (err, stream) => {
      if (err) return reject(err);

      let stdout = '';
      let stderr = '';

      stream.on('data', (d) => (stdout += d.toString()));
      stream.stderr.on('data', (d) => (stderr += d.toString()));

      stream.on('close', (code, signal) => {
        if (code === 0) {
          return resolve({ stdout, stderr, code, signal });
        }
        const e = new Error(
          `Remote command failed (exit ${code}${signal ? `, signal ${signal}` : ''}).\n` +
          `CMD: ${command}\n` +
          (stderr ? `STDERR:\n${stderr}\n` : '') +
          (stdout ? `STDOUT:\n${stdout}\n` : '')
        );
        reject(e);
      });

      if (stdinBuffer && stdinBuffer.length) {
        stream.end(stdinBuffer);
      } else {
        stream.end();
      }
    });
  });
};

const uploadBufferAtomic = async (conn, buffer, remotePath) => {
  const remoteDir = path.posix.dirname(remotePath);
  const tmpPath = `${remotePath}.tmp`;

  // Use a shell script so we can:
  //  - ensure dir exists
  //  - write to tmp via stdin
  //  - mv into place atomically
  const script =
    `set -e; ` +
    `umask 022; ` +
    `mkdir -p ${shQuote(remoteDir)}; ` +
    `cat > ${shQuote(tmpPath)}; ` +
    `mv -f ${shQuote(tmpPath)} ${shQuote(remotePath)};`;

  const cmd = `sh -lc ${shQuote(script)}`;

  await execWithStdin(conn, cmd, buffer);

  // Optional verification: show remote size
  const verifyCmd = `sh -lc ${shQuote(`ls -l ${shQuote(remotePath)} || true`)}`;
  const { stdout } = await execWithStdin(conn, verifyCmd);
  dlog('verify:', stdout.trim());
};

const sendFiles = async (files, opts = {}) => {
  const p = getPrinterParams();

  // Validate here (NOT at require-time)
  if (!p.host) {
    throw new Error(
      `Missing printer host/IP.\n` +
      `Set PRINTERIP in user-config.js (recommended, per README), or set PRINTER_IP.\n` +
      `Example user-config.js fields:\n` +
      `  PRINTERIP: '192.168.x.x', USER: 'root', PASSWORD: 'yourpass'\n`
    );
  }
  if (!p.password) {
    throw new Error(
      `Missing printer password.\n` +
      `Set PASSWORD in user-config.js (recommended), or set PRINTER_PASSWORD.\n`
    );
  }

  log(`Connecting to ${p.username}@${p.host}:${p.port || 22} ...`);

  const conn = await connectSSH(p);
  try {
    // Ensure base dir exists
    await execWithStdin(conn, `sh -lc ${shQuote(`mkdir -p ${shQuote(p.remoteDir)}`)}`);

    for (const f of files) {
      const localPath = f.local;
      const remotePath = f.remote;

      if (!fs.existsSync(localPath)) {
        throw new Error(`Local file not found: ${localPath}`);
      }

      const buf = fs.readFileSync(localPath);
      log(`Uploading ${path.basename(localPath)} (${buf.length} bytes) -> ${remotePath}`);

      await uploadBufferAtomic(conn, buf, remotePath);
    }

    log('Upload complete.');
  } finally {
    conn.end();
  }
};

const sendToPrinterAsync = async () => {
  const p = getPrinterParams();

  const dataDir = path.join(__dirname, '..', 'data');
  const dbLocal = path.join(dataDir, 'material_database.json');
  const optLocal = path.join(dataDir, 'material_option.json');

  const dbRemote = `${p.remoteDir}/material_database.json`;
  const optRemote = `${p.remoteDir}/material_option.json`;

  await sendFiles([
    { local: dbLocal, remote: dbRemote },
    { local: optLocal, remote: optRemote },
  ]);
};

// Export as a callable function (matches your main.js)
function sendToPrinter() {
  // IMPORTANT: main.js does not await, so we catch here to avoid unhandled rejections.
  sendToPrinterAsync().catch((err) => {
    console.error('[Filament-Sync][upload] FAILED:\n' + (err?.stack || err));
    process.exitCode = 1;
  });
}

// Hybrid exports: callable + properties
module.exports = sendToPrinter;
module.exports.sendToPrinter = sendToPrinter;
module.exports.sendFiles = sendFiles;
