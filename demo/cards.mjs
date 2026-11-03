function page(title, lines) {
  const body = lines.map(line => {
    const heading = line === line.toUpperCase() && !line.startsWith('$') && !line.startsWith('http') && !line.startsWith('npm');
    return heading ? `<h2>${escapeHtml(line)}</h2>` : `<p>${escapeHtml(line)}</p>`;
  }).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; width: 1280px; height: 720px; background: #111315; color: #f0ece2; }
    main { box-sizing: border-box; height: 720px; padding: 128px 80px 48px; font: 27px/1.35 ui-monospace, Menlo, monospace; }
    h1 { margin: 0 0 22px; font: 600 34px/1.2 ui-sans-serif, system-ui, sans-serif; letter-spacing: 0; }
    h1 span { color: #bce981; }
    h2 { margin: 18px 0 6px; color: #bce981; font: 600 15px/1.2 ui-sans-serif, system-ui, sans-serif; letter-spacing: 1.4px; }
    p { margin: 0 0 4px; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    ${body}
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return value.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
}

export function resultsCardHtml(lines) {
  const [title, ...rest] = lines;
  return page(`<span>${escapeHtml(title)}</span>`, rest);
}

export function closingCardHtml(lines) {
  const [title, ...rest] = lines;
  return page(`<span>${escapeHtml(title)}</span>`, rest);
}
