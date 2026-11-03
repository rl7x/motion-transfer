# Privacy note

Motion Transfer does not require an account. This note describes the local preview in this repository. A public host would need the same description only if its storage stays the same.

## Playing

Playing the saved challenge, borrowing the saved dash, and replaying it do not send a model request. Those actions do not create an account.

## Model requests

Starting an adaptation, remix, or investigation on the local server stores the request in a job journal on the machine running that server. Adaptation and remix journals include the raw request text. Investigation journals include the selected question and the stored report. The browser also keeps an in-progress adaptation, remix, or investigation in sessionStorage, and removes that entry when the job finishes or fails.

A checked artifact can include a short summary that restates the request. This preview does not delete journals or artifacts on a timer. They remain until an operator deletes them.

The local server can return a stored request to the browser that submitted it. That response stays on the local origin.

## 18+ confirmation

The 18+ confirmation is a flag in this tab's sessionStorage. It is not sent with the model request and it is not an account.

## What is not implemented

This application does not send data to a third-party tracking or analytics service. It does not collect anonymous aggregate counts of plays, remixes, downloads, or link opens. Those counts are not implemented. No automatic deletion is implemented, so this note does not promise a retention period.

## Models

Adaptation and remix forms call Standard Muse Spark (`muse-spark-1.3`). A future public generation service is intended to stay on that Standard mode. Contributor mode is only for authorized project development, such as an operator recovery campaign, and is not the visitor remix path. Do not send personal or confidential material through Contributor mode.

The playable challenge uses the saved recovery.

## Downloads and links

A downloaded Roadster game makes no model request. Opened on its own, it shows an intended-audience notice for adults 18 and older. PAKU remix downloads do not yet include that visible notice.

A copied address on localhost or 127.0.0.1 is a local preview address, not a public link. The preview accepts only its own local host.
