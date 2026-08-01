// Bundles ssr-entry.jsx to CJS and runs render checks — catches render-time crashes
// without needing a dev server.
import { build } from 'esbuild';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

await build({
  entryPoints: ['/home/arch/keepersense/frontend/ssr-entry.jsx'],
  bundle: true,
  outfile: '/home/arch/keepersense/frontend/.ssr-bundle.cjs',
  format: 'cjs',
  platform: 'node',
  external: ['react', 'react-dom'],
  logLevel: 'error',
});

const { runChecks } = require('/home/arch/keepersense/frontend/.ssr-bundle.cjs');
const lines = runChecks();
for (const l of lines) console.log(l);
process.exit(lines.some((l) => l.startsWith('FAIL')) ? 1 : 0);
