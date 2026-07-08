// Entry point. Boots the Express app and listens on the configured port.
// Env validation happens on import of config/env.js, so a missing required key
// fails fast here with a clear message.

import { createApp } from './src/app.js';
import { env } from './src/config/env.js';
import { cache } from './src/lib/cache.js';

const app = createApp();

app.listen(env.port, () => {
  console.log(`Outreach backend listening on http://localhost:${env.port}`);
  console.log(`  lead provider:      hunter`);
  console.log(`  cache backend:      ${cache.backend}`);
  console.log(`  supabase enabled:   ${env.supabase.enabled}`);
});
