const AGE_CONTROL = /18\s*(?:\+|or older|and older)|at least 18|older than 17/i;
const JOB_SUBMITS = new Set(['roadster-submit', 'remix-submit', 'investigation-submit', 'recover-project']);

async function isJobSubmit(button) {
  const id = await button.getAttribute('id');
  if (id && JOB_SUBMITS.has(id)) return true;
  return button.evaluate(element => {
    const type = (element.getAttribute('type') || '').toLowerCase();
    if (type === 'submit') return true;
    return !type && Boolean(element.closest('form'));
  });
}

// The product checkbox is #confirm-age: "I am 18 or older. No account is required to play or create."
// Playback stays available without it. Check it with a real click when it is shown.
// Generation submit buttons are left for the test.
export async function acknowledgeAge(page) {
  const ageBox = page.locator('#confirm-age');
  if (await ageBox.count()) {
    for (let step = 0; step < 8 && !(await ageBox.isVisible()); step += 1) {
      if (!(await openOutermostClosedDetails(page, '#confirm-age'))) break;
    }
    if ((await ageBox.isVisible()) && !(await ageBox.isChecked())) await ageBox.check();
  }
  const boxes = page.getByRole('checkbox', { name: AGE_CONTROL });
  const boxCount = await boxes.count();
  for (let index = 0; index < boxCount; index += 1) {
    const box = boxes.nth(index);
    if ((await box.isVisible()) && !(await box.isChecked())) await box.check();
  }
  const explicit = page.locator('button#acknowledge-age, button[data-acknowledge-age], [role="button"][data-acknowledge-age]');
  if ((await explicit.count()) && (await explicit.first().isVisible()) && !(await isJobSubmit(explicit.first()))) {
    await explicit.first().click();
  }
  const dialog = page.locator('[role="dialog"], dialog[open]').filter({ hasText: AGE_CONTROL }).first();
  if (!(await dialog.count()) || !(await dialog.isVisible())) return;
  const confirm = dialog.getByRole('button', { name: /18|continue|agree|confirm/i });
  const confirmCount = await confirm.count();
  for (let index = 0; index < confirmCount; index += 1) {
    const button = confirm.nth(index);
    if (!(await button.isVisible()) || (await isJobSubmit(button))) continue;
    await button.click();
    break;
  }
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
