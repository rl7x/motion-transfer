export function PrivacyNote() {
  return (
    <details id="privacy-note" className="privacy-note">
      <summary>Privacy note</summary>
      <div>
        <p>
          Motion Transfer does not require an account. This note describes the local preview. A
          public host would need the same description only if its storage stays the same.
        </p>
        <p>
          Playing the saved challenge, borrowing the saved dash, and replaying it do not send a
          model request.
        </p>
        <p>
          Starting an adaptation, remix, or investigation stores the request in a job journal on the
          machine running the server. Adaptation and remix journals keep the raw request text.
          Investigation journals keep the selected question and the stored report. The browser keeps
          an in-progress request in sessionStorage and removes that entry when the job finishes or
          fails. The local server can return a stored request to the browser that submitted it. That
          response stays on the local origin. A checked artifact can include a short summary that
          restates the request. Nothing here deletes those journals or artifacts on a timer. They
          remain until an operator deletes them.
        </p>
        <p>
          The 18+ confirmation is a flag in this tab&apos;s sessionStorage. It is not sent as an
          account and it is not a profile.
        </p>
        <p>
          This application does not send data to a third-party tracking or analytics service. It
          does not collect anonymous aggregate counts of plays, remixes, downloads, or link opens.
          Those counts are not implemented.
        </p>
        <p>
          Adaptation and remix forms call Standard Muse Spark (muse-spark-1.3). Public generation,
          when it exists, stays on that Standard mode. Contributor mode is only for authorized
          project development, not visitor remixes. The playable challenge uses the saved recovery.
        </p>
        <p>
          A downloaded Roadster game makes no model request. Opened on its own, it shows an
          intended-audience notice for adults 18 and older. A copied localhost or 127.0.0.1 address
          is a local preview address, not a public link.
        </p>
      </div>
    </details>
  );
}
