const fs = require('node:fs');
const validator = require('gltf-validator');

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node validate-gltf.cjs model.glb khronos-report.json');
  const bytes = new Uint8Array(fs.readFileSync(input));
  const report = await validator.validateBytes(bytes, { uri: input, maxIssues: 200 });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  const issues = report.issues || {};
  console.log(JSON.stringify({ errors: issues.numErrors || 0, warnings: issues.numWarnings || 0,
    infos: issues.numInfos || 0, hints: issues.numHints || 0 }));
  if (issues.numErrors) process.exitCode = 1;
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 2; });
