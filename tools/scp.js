const fs = require('fs');
const path = require('path');

const cfg = require('../user-config');
const {
  DEBUG,
  dlog,
  connectSSH,
  exec,
  readRemoteFile,
  writeRemoteFileAtomic,
} = require('./ssh-util');

// Local project paths
const PROJECT_ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const BACKUP_DIR = path.join(PROJECT_ROOT, 'backups');

const nowStamp = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '_' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
};

const getPrinterConfig = () => {
  // Support both upstream name (PRINTERIP) and our preferred PRINTER_IP
  const host = cfg.PRINTER_IP || cfg.PRINTERIP || cfg.HOST || cfg.HOSTNAME;
  const port = Number(cfg.PORT || 22);
  const username = cfg.USER || 'root';
  const password = cfg.PASSWORD;

  // Default to the service watch folder.
  const remoteDir = cfg.REMOTE_SYNC_DIR || '/usr/share/Filament-Sync';

  if (!host) {
    throw new Error(
      'Missing printer host/IP. Set PRINTER_IP (recommended) or PRINTERIP in user-config.js'
    );
  }
  if (!password) {
    throw new Error('Missing printer password. Set PASSWORD in user-config.js');
  }

  return { host, port, username, password, remoteDir };
};

const ensureLocalDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const backupRemoteFiles = async (conn, remoteDir, filenames) => {
  const doBackup =
    process.env.FILAMENT_SYNC_BACKUP !== '0' &&
    process.env.FILAMENT_SYNC_BACKUP !== 'false';

  if (!doBackup) return;

  ensureLocalDir(BACKUP_DIR);
  const stamp = nowStamp();
  const outDir = path.join(BACKUP_DIR, stamp);
  ensureLocalDir(outDir);

  for (const name of filenames) {
    const remotePath = `${remoteDir}/${name}`;
    try {
      const content = await readRemoteFile(conn, remotePath);
      const localPath = path.join(outDir, name);
      fs.writeFileSync(localPath, content, 'utf8');
      if (DEBUG) dlog(`backup: saved ${remotePath} -> ${localPath}`);
    } catch (e) {
      // Remote file may not exist yet; that's fine.
      if (DEBUG) dlog(`backup: skip ${remotePath} (${e.message.split('\n')[0]})`);
    }
  }
};

const uploadFiles = async ({ remoteDir }) => {
  ensureLocalDir(DATA_DIR);

  const filenames = ['material_database.json', 'material_option.json'];

  const { host, port, username, password } = getPrinterConfig();

  dlog(`Connecting to ${username}@${host}:${port} ...`);

  const conn = await connectSSH({ host, port, username, password });

  try {
    // Ensure remote dir exists
    dlog(`exec: mkdir -p ${remoteDir}`);
    await exec(conn, `mkdir -p '${remoteDir.replace(/'/g, "'\\''")}'`);

    // Backup current remote copies (optional)
    await backupRemoteFiles(conn, remoteDir, filenames);

    // Upload
    for (const name of filenames) {
      const localPath = path.join(DATA_DIR, name);
      const remotePath = `${remoteDir}/${name}`;

      if (!fs.existsSync(localPath)) {
        throw new Error(`Local file missing: ${localPath}\nDid main.js generate it?`);
      }

      const data = fs.readFileSync(localPath);
      dlog(`Uploading ${name} (${data.length} bytes) -> ${remotePath}`);
      await writeRemoteFileAtomic(conn, remotePath, data);

      const verify = await exec(conn, `ls -l '${remotePath.replace(/'/g, "'\\''")}' || true`);
      if (DEBUG) dlog('verify:', (verify.stdout || verify.stderr || '').trim());
    }

    dlog('Upload complete.');
  } finally {
    conn.end();
  }
};

// Upstream compatibility: main.js expects require('./tools/scp.js') to be callable.
const sendFiles = async () => uploadFiles(getPrinterConfig());

module.exports = sendFiles;
module.exports.sendFiles = sendFiles;
