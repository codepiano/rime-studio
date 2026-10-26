import { execFileSync } from 'node:child_process';

const [major, minor] = process.versions.node.split('.').map(Number);
if (!((major === 24 && minor >= 15) || major === 26)) {
  throw new Error('需要 Node.js 24.15+（24.x）或 26.x');
}
let version;
try {
  version = execFileSync('corepack', ['--version'], { encoding: 'utf8' }).trim();
} catch {
  throw new Error('请先安装 Corepack 0.36.0+：npm install --global corepack@0.36.0');
}
const [coreMajor, coreMinor] = version.split('.').map(Number);
if (!(coreMajor > 0 || (coreMajor === 0 && coreMinor >= 36))) {
  throw new Error('Corepack ' + version + ' 无法用于本项目；请先运行 npm install --global corepack@0.36.0');
}
console.log(`Node.js ${process.versions.node}, Corepack ${version}`);
