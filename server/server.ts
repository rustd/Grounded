import { createApp, lakebase, server, serving } from '@databricks/appkit';
import { setupHackEventRoutes } from './routes/hackevent-routes';

createApp({
  plugins: [
    lakebase(),
    server(),
    serving({
      endpoints: {
        agent: { env: 'DATABRICKS_SERVING_ENDPOINT_AGENT' },
      },
      timeout: 15000,
    }),
  ],
  async onPluginsReady(appkit) {
    await setupHackEventRoutes(appkit);
  },
}).catch(console.error);
