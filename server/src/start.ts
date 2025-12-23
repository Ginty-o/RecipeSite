import 'dotenv/config';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function runPrismaDbPush(serverRoot: string) {
  const prismaBinName = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
  const prismaBinPath = path.join(serverRoot, 'node_modules', '.bin', prismaBinName);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(prismaBinPath, ['db', 'push'], {
      cwd: serverRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        PRISMA_HIDE_UPDATE_MESSAGE: 'true'
      }
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`prisma db push exited with code ${code ?? 'null'}`));
    });
  });
}

const distDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(distDir, '..');

const defaultAuto = process.env.NODE_ENV === 'production' ? 'true' : 'false';
const autoDbPushRaw = (process.env.AUTO_DB_PUSH ?? defaultAuto).toLowerCase();
const shouldAutoDbPush = ['1', 'true', 'yes', 'on'].includes(autoDbPushRaw);

if (shouldAutoDbPush) {
  if (!process.env.DATABASE_URL) {
    // eslint-disable-next-line no-console
    console.error('AUTO_DB_PUSH is enabled but DATABASE_URL is not set.');
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log('AUTO_DB_PUSH enabled: running prisma db push...');

  try {
    await runPrismaDbPush(serverRoot);
    // eslint-disable-next-line no-console
    console.log('prisma db push complete.');
  } catch (err) {
    console.error('prisma db push failed:', err);
    process.exit(1);
  }
}

// Start the actual server
await import('./index.js');
