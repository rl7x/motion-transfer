import type { ReactNode } from 'react';

export function JsonDetails({
  label,
  value,
  open = false,
}: {
  label: string;
  value: unknown;
  open?: boolean;
}) {
  return (
    <details open={open}>
      <summary>{label}</summary>
      <pre>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
export function MeasurementTable({ labels, rows }: { labels: string[]; rows: ReactNode[][] }) {
  return (
    <div className="measurement-table">
      <table>
        <thead>
          <tr>
            {labels.map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((value, cell) => (
                <td key={cell}>{value ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function EvidenceLinks({ ids }: { ids: string[] }) {
  return (
    <p className="evidence-links">
      {ids.map((id) => (
        <a key={id} href={'#' + encodeURIComponent('evidence-' + id)}>
          {id}{' '}
        </a>
      ))}
    </p>
  );
}
export function DownloadButton({
  label,
  text,
  name,
  type = 'application/json',
}: {
  label: string;
  text: string;
  name: string;
  type?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        const url = URL.createObjectURL(new Blob([text], { type }));
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}
    >
      {label}
    </button>
  );
}
