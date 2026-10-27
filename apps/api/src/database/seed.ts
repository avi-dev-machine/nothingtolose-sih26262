import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const seedScript = path.resolve(__dirname, '../../../../infra/db/seeds/seed_generator.ts');

console.log('[Seed] Spawning database seed script...');
const child = spawn('npx', ['tsx', seedScript], { stdio: 'inherit', shell: true });

child.on('exit', (code) => {
  if (code === 0) {
    console.log('[Seed] Process finished with success.');
    process.exit(0);
  } else {
    console.error(`[Seed] Process exited with code ${code}`);
    process.exit(code || 1);
  }
});
