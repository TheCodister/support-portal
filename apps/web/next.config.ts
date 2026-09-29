import type { NextConfig } from "next";
const config: NextConfig = { output: "standalone", transpilePackages: ["@supportdesk/contracts"] };
export default config;
