import webpack from 'webpack';
import { buildConfig } from './webpack.config.js';

export const runBundler = (cwd: string): Promise<void> =>
  new Promise((res, rej) => {
    webpack(buildConfig(cwd), (err, stats) => {
      if (err) return rej(err);
      if (!stats) return rej(new Error('webpack returned no stats'));
      if (stats.hasErrors()) {
        return rej(new Error(stats.toString({ all: false, errors: true, errorDetails: true })));
      }
      res();
    });
  });
