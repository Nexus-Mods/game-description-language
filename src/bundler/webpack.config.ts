import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import type { Configuration } from 'webpack';

const here = dirname(fileURLToPath(import.meta.url));
const bundleTsConfig = resolve(here, 'tsconfig.bundle.json');
const gdlNodeModules = resolve(here, '..', '..', 'node_modules');

export const buildConfig = (cwd: string): Configuration => ({
  mode: 'production',
  devtool: 'source-map',
  entry: join(cwd, '.gdl-out', 'extension.ts'),
  target: 'node',
  output: {
    path: join(cwd, 'dist'),
    filename: 'index.js',
    libraryTarget: 'commonjs2',
  },
  resolveLoader: {
    modules: [gdlNodeModules, 'node_modules'],
  },
  resolve: {
    extensions: ['.ts', '.js'],
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
    alias: {
      '@gdl/runtime': resolve(here, '..', 'runtime'),
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: 'ts-loader',
        options: {
          transpileOnly: true,
          configFile: bundleTsConfig,
          compilerOptions: { module: 'commonjs', target: 'es2022' },
        },
      },
    ],
  },
  externals: {
    // Vortex injects the API at runtime under both specifiers; extensions
    // (and their src/hooks.ts) must not bundle it. Mirrors the externals used
    // by Vortex's own Rolldown extension build.
    'vortex-api': 'commonjs2 vortex-api',
    '@nexusmods/vortex-api': 'commonjs2 @nexusmods/vortex-api',
    // Native registry bindings used by GDL discovery; Vortex's runtime provides
    // the module (only meaningful on Windows), so leave it external.
    'winapi-bindings': 'commonjs2 winapi-bindings',
  },
});
