/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
  async rewrites() {
    return [
      {
        source: "/docs",
        destination: "/docs/index.html",
      },
      {
        source: "/docs/:path*/",
        destination: "/docs/:path*/index.html",
      },
      {
        source: "/docs/:path*",
        has: [
          {
            type: "header",
            key: "accept",
            value: ".*text/html.*",
          },
        ],
        destination: "/docs/:path*/index.html",
      },
    ];
  },
};

module.exports = nextConfig;
