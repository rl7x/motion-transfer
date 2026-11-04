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
  for (let step = 0; step < 8; step += 1) {
    if (!(await openOutermostClosedDetails(page, selector))) break;
  }
  await target.scrollIntoViewIfNeeded();
  await target.waitFor({ state: 'visible' });
}
