const { Client } = require('ssh2');

const DEBUG =
  process.env.FILAMENT_SYNC_DEBUG === '1' ||
  process.env.FILAMENT_SYNC_DEBUG === 'true';

const dlog = (...args) => {
  if (DEBUG) console.log('[Filament-Sync][upload]', ...args);
};

const shellQuote = (s) => {
  // Single-quote for sh, escaping any single quotes inside.
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
};

const connectSSH = ({ host, port, username, password, readyTimeout = 20000 }) => {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    conn
      .on('ready', () => resolve(conn))
      .on('error', (err) => reject(err))
      .connect({
        host,
        port,
        username,
        password,
        readyTimeout,
      });
  });
};

const exec = (conn, command, { stdin } = {}) => {
  return new Promise((resolve, reject) => {
    // Use sh -c (not -l) to avoid noisy login banners on some firmware.
    conn.exec(`sh -c ${shellQuote(command)}`, (err, stream) => {
      if (err) return reject(err);

      let stdout = '';
      let stderr = '';

      stream
        .on('close', (code, signal) => {
          resolve({ stdout, stderr, code, signal });
        })
        .on('data', (data) => {
          stdout += data.toString('utf8');
        });

      stream.stderr.on('data', (data) => {
        stderr += data.toString('utf8');
      });

      if (stdin !== undefined) {
        stream.end(stdin);
      }
    });
  });
};

const readRemoteFile = async (conn, remotePath) => {
  const cmd = `cat ${shellQuote(remotePath)}`;
  const res = await exec(conn, cmd);
  if (res.code !== 0) {
    const msg = res.stderr || res.stdout || `Exit code ${res.code}`;
    throw new Error(`Failed to read remote file: ${remotePath}\n${msg}`);
  }
  return res.stdout;
};

const writeRemoteFileAtomic = async (conn, remotePath, content, { umask = '022' } = {}) => {
  const dir = remotePath.replace(/\/[^/]+$/, '');
  const tmp = `${remotePath}.tmp`;

  const cmd = `set -e; umask ${umask}; mkdir -p ${shellQuote(dir)}; cat > ${shellQuote(tmp)}; mv -f ${shellQuote(tmp)} ${shellQuote(remotePath)};`;
  const res = await exec(conn, cmd, { stdin: content });
  if (res.code !== 0) {
    const msg = res.stderr || res.stdout || `Exit code ${res.code}`;
    throw new Error(`Failed to write remote file: ${remotePath}\n${msg}`);
  }
};

module.exports = {
  DEBUG,
  dlog,
  shellQuote,
  connectSSH,
  exec,
  readRemoteFile,
  writeRemoteFileAtomic,
};
