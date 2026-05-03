import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  turbopack: {
    root: __dirname,
  },
  experimental: {
    optimizePackageImports: ["@mui/icons-material", "@mui/material"],
  },
};

export default nextConfig;
