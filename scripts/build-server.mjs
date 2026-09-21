import { build } from 'esbuild';
await build({
  entryPoints: ['apps/server/index.ts'],
  outfile: 'dist-server/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  banner: { js: "process.env.NODE_ENV ??= 'production';" },
});
