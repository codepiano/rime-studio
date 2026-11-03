import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';

test('desktop learned vocabulary filter and export agree',async({page})=>{
 const folder=process.env.RIME_QA_USER_DIR+'/sync/test-user';await fs.mkdir(folder,{recursive:true});
 await fs.writeFile(folder+'/base.userdb.txt','#@/db_name\tbase\n#@/db_type\tuserdb\n#@/user_id\ttest-user\nni hao \t你好\tc=8 d=0.1 t=1\nxin ci \t新造词\tc=1 d=0.1 t=2\nzi \t字\tc=1 d=0.1 t=3\n');
 await page.goto('/');await page.locator('[data-view="library"]').click();await page.locator('[data-library-tab="learned"]').click();
 await page.locator('[data-learn-refresh]').click();await expect(page.locator('.learned-table tbody')).toContainText('你好');await expect(page.locator('.learned-table tbody')).toContainText('新造词');
 await page.locator('#learned-only-new').check();await expect(page.locator('.learned-table tbody')).not.toContainText('你好');await expect(page.locator('.learned-table tbody')).toContainText('新造词');
 await expect(page.locator('.learned-table tbody tr')).toHaveCount(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const download=page.waitForEvent('download');await page.locator('[data-learn-export]').click();const result=await download;const stream=await result.createReadStream();const chunks=[];for await(const chunk of stream!)chunks.push(chunk);const text=Buffer.concat(chunks).toString();expect(text).toContain('新造词');expect(text).not.toContain('你好');expect(text).not.toContain('\n字\t');
 await page.screenshot({path:'/tmp/rime-learned-filter-desktop.png',fullPage:true});
 await page.locator('#learned-only-new').uncheck();await expect(page.locator('.learned-table tbody')).toContainText('你好');
});
