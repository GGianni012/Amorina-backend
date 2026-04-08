import { test, expect, devices } from 'playwright/test';

const clientUrl = process.env.CLIENT_APP_URL || 'http://127.0.0.1:4043/mesa.html';
const staffUrl = process.env.STAFF_APP_URL || 'http://127.0.0.1:4044/staff';

const mobileDevice = devices['iPhone 12'];

test.describe.configure({ mode: 'serial' });
test.use({
  ...mobileDevice,
  browserName: 'chromium',
  timezoneId: 'America/Argentina/Buenos_Aires',
  locale: 'es-AR',
  colorScheme: 'light',
});

test('client mesa viva fits mobile viewport', async ({ page }) => {
  await page.goto(clientUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('.hero');

  const metrics = await collectViewportMetrics(page);
  expect(metrics.horizontalOverflow).toBeFalsy();

  await page.screenshot({
    path: 'artifacts/mobile-client.png',
    fullPage: true,
  });
});

test('staff cabin fits mobile viewport after login', async ({ page }) => {
  await page.goto(staffUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('#loginForm');

  await page.selectOption('#staffUserInput', 'mesero');
  await page.fill('#staffPasswordInput', 'mesa57');
  await page.click('#loginSubmitBtn');
  await page.waitForSelector('#staffAppShell:not(.hidden)');
  await page.waitForSelector('.tables-panel');
  await page.click('.table-card');
  await page.waitForSelector('#tableModal:not(.hidden)');

  const metrics = await collectViewportMetrics(page);
  expect(metrics.horizontalOverflow).toBeFalsy();

  await page.screenshot({
    path: 'artifacts/mobile-staff.png',
    fullPage: true,
  });
});

async function collectViewportMetrics(page) {
  return page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const doc = document.documentElement;
    const body = document.body;
    const offenders = [];

    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = el.getBoundingClientRect();
      const overflowRight = rect.right - viewportWidth;
      if (overflowRight > 1) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          className: el.className,
          text: (el.textContent || '').trim().slice(0, 60),
          overflowRight: Math.round(overflowRight),
          width: Math.round(rect.width),
        });
      }
    }

    return {
      viewportWidth,
      documentScrollWidth: doc.scrollWidth,
      bodyScrollWidth: body.scrollWidth,
      horizontalOverflow: doc.scrollWidth > viewportWidth + 1 || body.scrollWidth > viewportWidth + 1,
      offenders: offenders.slice(0, 10),
    };
  });
}
