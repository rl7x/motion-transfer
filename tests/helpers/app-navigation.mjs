// Non-admission tests start with an acknowledged adult session. Dedicated
// product tests exercise the real creation-only dialog and cancellation.
export async function acknowledgeAge(page) {
  await page.evaluate(() => {
    try { sessionStorage.setItem('motion-transfer-age', JSON.stringify('18+')); } catch { /* Opaque game frames have no storage. */ }
  });
  const dialog = page.getByRole('dialog', {name:'Confirm before creating'});
  if (await dialog.isVisible()) await dialog.locator('#confirm-age').click();
}

export async function prepareVisitor(page) {
  await acknowledgeAge(page);
}

async function openOutermostClosedDetails(page, selector) {
  const text = await page.locator(selector).first().evaluate(element => {
    let node = element instanceof HTMLDetailsElement ? element : element.parentElement;
    let label = null;
    while (node) {
      if (node instanceof HTMLDetailsElement && !node.open) {
        label = (node.querySelector(':scope > summary')?.textContent ?? '').replace(/\s+/g, ' ').trim();
      }
      node = node.parentElement;
    }
    return label;
  });
  if (!text) return false;
  const summary = page.locator('details:not([open]) > summary').filter({ hasText: text }).first();
  await summary.click();
  await page.waitForFunction(({ selector: target, text: label }) => {
    const element = document.querySelector(target);
    if (!element) return false;
    let node = element instanceof HTMLDetailsElement ? element : element.parentElement;
    while (node) {
      if (node instanceof HTMLDetailsElement && !node.open) {
        const current = (node.querySelector(':scope > summary')?.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (current === label) return false;
      }
      node = node.parentElement;
    }
    return true;
  }, { selector, text });
  return true;
}

// Open every closed details ancestor by clicking its summary, outermost first.
export async function reveal(page, selector) {
  const target = page.locator(selector).first();
  await target.waitFor({ state: 'attached' });
  await acknowledgeAge(page);
  for (let step = 0; step < 8; step += 1) {
    if (!(await openOutermostClosedDetails(page, selector))) break;
  }
  await acknowledgeAge(page);
  await target.scrollIntoViewIfNeeded();
  await target.waitFor({ state: 'visible' });
}
