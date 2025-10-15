import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */
const sidebars: SidebarsConfig = {
  primarySidebar: [
    {
      type: 'category',
      label: 'Overview',
      collapsed: false,
      items: ['overview/index', 'overview/getting-started', 'overview/glossary'],
    },
    {
      type: 'category',
      label: 'Core Concepts',
      items: [
        'core-concepts/positions',
        'core-concepts/execution-pipeline',
        'core-concepts/security-controls',
      ],
    },
    {
      type: 'category',
      label: 'User Guides',
      items: [
        'user-guides/create-position',
        'user-guides/manage-balances',
        'user-guides/use-cases',
      ],
    },
    {
      type: 'category',
      label: 'Developer Guides',
      items: [
        'developer/architecture',
        'developer/smart-contracts',
        'developer/integration-guide',
        'developer/sdk-and-tools',
        'developer/testing',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: ['reference/api-reference', 'reference/events', 'reference/configuration'],
    },
    {
      type: 'category',
      label: 'Operations',
      items: ['troubleshooting/faq', 'troubleshooting/troubleshooting'],
    },
  ],
};

export default sidebars;
