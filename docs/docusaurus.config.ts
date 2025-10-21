import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'DCA Crypto Docs',
  tagline: 'Non-custodial automated dollar cost averaging for crypto assets',
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  url: 'https://docs.dcacrypto.xyz',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/docs/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'bobjiang',
  projectName: 'dcacrypto',

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/bobjiang/dcacrypto/tree/main/docs',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        language: ['en'],
        highlightSearchTermsOnTargetPage: true,
        docsRouteBasePath: '/',
      },
    ],
  ],

  themeConfig: {
    metadata: [
      {name: 'keywords', content: 'DCA Crypto, DCA, DeFi, Ethereum, WBTC, automated trading, Chainlink'},
      {name: 'twitter:card', content: 'summary_large_image'},
    ],
    image: 'img/docusaurus-social-card.jpg',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'DCA Crypto',
      logo: {
        alt: 'DCA Crypto',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'primarySidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          href: 'https://github.com/bobjiang/dcacrypto',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Product',
          items: [
            {
              label: 'Overview',
              to: '/',
            },
            {
              label: 'User Guides',
              to: '/user-guides/create-position',
            },
          ],
        },
        {
          title: 'Developers',
          items: [
            {
              label: 'Architecture',
              to: '/developer/architecture',
            },
            {
              label: 'API Reference',
              to: '/reference/api-reference',
            },
          ],
        },
        {
          title: 'Connect',
          items: [
            {
              label: 'Repository',
              href: 'https://github.com/bobjiang/dcacrypto',
            },
            {
              label: 'Community Chat',
              href: 'https://discord.gg/dcacrypto',
            },
          ],
        },
      ],
      copyright: `© ${new Date().getFullYear()} DCA Crypto Contributors`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['solidity', 'typescript', 'bash'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
