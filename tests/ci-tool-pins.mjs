import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow=readFileSync('.github/workflows/copilot-setup-steps.yml','utf8');
const installs=[...workflow.matchAll(/^\s*run:\s*npm install -g @fission-ai\/openspec([^\s]*)\s*$/gm)];
assert.equal(installs.length,1,'Exactly one OpenSpec installation is reviewed');
assert.equal(installs[0][1],'@1.13.1','F7: pin OpenSpec to the reviewed local version');
console.log('PASS: Copilot setup pins OpenSpec 1.13.1; workflow not executed');
