// A hand-written stand-in for a GDL-built extension bundle: CommonJS, keeps
// `@nexusmods/vortex-api` external (required at call time), registers a custom
// install hook + a health check. Used to test the corpus execution runner.
module.exports = function main(ctx) {
  ctx.registerGame({ id: 'exectest' });

  ctx.registerInstaller(
    'content-xml',
    50,
    async (files) => ({ supported: files.some((f) => /(^|\/)content\.xml$/i.test(f)) }),
    async (files) => {
      // Read the synthetic content.xml through the (mocked) vortex-api fs.
      const { fs, util } = require('@nexusmods/vortex-api');
      const data = await fs.readFileAsync('/virtual-dest/content.xml');
      const text = String(data);
      const m = text.match(/id="([^"]+)"/);
      if (!m) throw new util.DataInvalid('content.xml missing id');
      return {
        instructions: [
          { type: 'attribute', key: 'customFileName', value: `name-${m[1]}` },
          ...files
            .filter((f) => !f.endsWith('/'))
            .map((f) => ({ type: 'copy', source: f, destination: `${m[1]}/${f}` })),
        ],
      };
    },
  );

  ctx.registerHealthCheck({
    id: 'has-custom-name',
    checkMod: async (_api, mod) =>
      mod.attributes.customFileName !== undefined
        ? { status: 'passed', severity: 'info', message: 'ok' }
        : { status: 'warning', severity: 'warning', message: 'missing customFileName' },
  });
};
