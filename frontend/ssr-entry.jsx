// SSR smoke test entry — bundled to CJS by verify-ssr.mjs
import React from 'react';
import { renderToString } from 'react-dom/server';
import Landing from './src/Landing.jsx';
import PipelineView from './src/PipelineView.jsx';

export function runChecks() {
  const out = [];
  const landingHtml = renderToString(React.createElement(Landing));
  const checks = [
    ['landing renders', landingHtml.length > 1000],
    ['header logo', landingHtml.includes('Keeper') && landingHtml.includes('SENSE')],
    ['hero title', landingHtml.includes('can reason')],
    ['5 tool rows', (landingHtml.match(/proj-row/g) || []).length >= 5],
    ['marquee', landingHtml.includes('mq-track')],
    ['journal', (landingHtml.match(/j-item/g) || []).length >= 5],
    ['footer link', landingHtml.includes('github.com/subheeksh5599/keepersense')],
    ['pipeline links', landingHtml.includes('#/app')],
  ];
  for (const [name, ok] of checks) out.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  const pipeHtml = renderToString(React.createElement(PipelineView));
  out.push(`${(pipeHtml.includes('Intent') && pipeHtml.includes('SENSE') && pipeHtml.includes('pl-card')) ? 'PASS' : 'FAIL'} pipeline view renders`);

  const failed = checks.filter(([, ok]) => !ok).length;
  out.push(failed === 0 ? 'ALL SSR CHECKS PASSED' : `${failed} CHECKS FAILED`);
  return out;
}
