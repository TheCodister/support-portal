import type { NextConfig } from "next";
const config: NextConfig = { output: process.env.STATIC_EXPORT === "true" ? "export" : "standalone", transpilePackages: ["@supportdesk/contracts"] };
export default config;
