if (!process.env.RIME_QA_URL) throw new Error('请通过 npm run test:ui 启动隔离测试');
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './test/ui', timeout: 30000, workers: 1, use: { baseURL: process.env.RIME_QA_URL, viewport: { width: 1440, height: 1000 }, launchOptions: { executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } }, reporter: 'list' });
