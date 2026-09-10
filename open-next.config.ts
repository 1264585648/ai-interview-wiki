import { defineCloudflareConfig } from "@opennextjs/cloudflare";

const config = defineCloudflareConfig({});
config.dangerous = {
  disableIncrementalCache: true,
  disableTagCache: true,
};

export default config;
