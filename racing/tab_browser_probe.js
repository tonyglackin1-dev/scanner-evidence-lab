const { chromium } = require('playwright-chromium');
(async () => {
 const browser = await chromium.launch({headless:true});
 const page = await browser.newPage({locale:'en-AU'});
 const urls = [
  'https://api.beta.tab.com.au/v1/tab-info-service/racing/dates/2026-10-05/meetings?jurisdiction=QLD',
  'https://api.beta.tab.com.au/v1/tab-info-service/racing/dates/2026-10-05/meetings/R/DBN/races/4?jurisdiction=QLD'
 ];
 for (const url of urls) {
  try {
   const r = await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
   const body = await page.locator('body').innerText();
   console.log(JSON.stringify({url,status:r&&r.status(),contentType:r&&r.headers()['content-type'],prefix:body.slice(0,1200)}));
  } catch(e) { console.log(JSON.stringify({url,error:String(e)})); }
 }
 await browser.close();
})();
