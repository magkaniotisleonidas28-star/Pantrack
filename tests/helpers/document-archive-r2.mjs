import {mkdirSync} from 'node:fs';
import {build} from 'esbuild';
mkdirSync('.sites-runtime',{recursive:true});
await build({stdin:{contents:['r2-document-archive-objects','purchase-order-document-archive-contract','purchase-order-document-archive',
  'purchase-order-document-archive-sources','d1-document-archive-journal','d1-purchase-order-drafts','d1-purchase-order-history-exports',
].map(name=>`export * from './src/lib/${name}.ts';`).join('\n'),resolveDir:process.cwd()},bundle:true,packages:'external',platform:'node',format:'esm',outfile:'.sites-runtime/document-archive-r2-core.mjs'});
export const core=await import('../../.sites-runtime/document-archive-r2-core.mjs');
export const archiveTestKey=async(bytes,format='pdf',id=crypto.randomUUID(),company='a'.repeat(64))=>
  `pantrack-documents/v1/${company}/${id}/${await core.documentByteDigest(bytes)}.${format}`;
