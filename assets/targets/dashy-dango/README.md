# Dashy Dango target

Pinned, precompiled WASM-4 cartridge for dash movement and cooldown extraction.

- **Upstream:** [willGuimont/dashy-dango](https://github.com/willGuimont/dashy-dango)
- **Revision:** `9b899e81790fb3c67243f4707244b3859a91e1c6`
- **Original artifact:** `build/cart.wasm`
- **Local artifact:** [cart.wasm](cart.wasm), 47,101 bytes
- **SHA-256:** `152d44c6e9ef48a254125cd5ebe266998a9bc74ea104692f5d2280fca6e9b42f`
- **Manifest:** [target.lock.json](target.lock.json)

The download's hash was checked against the artifact inspected during design research. This is an unchanged upstream build; it has not been rebuilt locally. The original source is not included in this folder. Recovery has since produced a separately packaged [standalone dash controller](../../components/dashy-dango-dash/README.md); the manifest's original retrieval-time scope is historical metadata.

## Play locally

From the repository root:

```sh
npm install
npm run dev
```

Open the local URL printed in the terminal (normally `http://localhost:4444`). The runtime is pinned in the root package lockfile.

## Recovery inputs

Provide the recovery model with the cartridge, the WASM-4 host interface, and experiment tools. Keep upstream source, source-derived findings from the design document, and evaluator answers outside its isolated workspace. This README and manifest are provenance records, not recovery prompts.

## Redistribution status

The redistribution basis is the authors' **ISC-licensed Wasmer release**, not the separate gallery license. On November 2, 2026, the public [Wasmer registry](https://wasmer.io/willGuimont/dashy-dango) reported `willGuimont/dashy-dango@1.0.0` as ISC. Its manifest identifies `build/cart.wasm`. The [pinned upstream package declaration](https://github.com/willGuimont/dashy-dango/blob/9b899e81790fb3c67243f4707244b3859a91e1c6/wapm.toml) also declares ISC.

The [registry archive](https://cdn.wasmer.io/packages/willGuimont/dashy-dango/dashy-dango-1.0.0.tar.gz) was downloaded and inspected without extracting or executing it. Its SHA-256 is `b12afa8a93b0a53e2a9c7ab7e966050b350681be4b7dab0fbfe779692aacec56`. The archive's `build/cart.wasm` is 47,101 bytes, has the pinned SHA-256 above, and was compared byte-for-byte with the local cartridge: identical. Its README credits samX500 and willGuimont.

The [WASM-4 distribution guide](https://wasm4.org/docs/guides/distribution/) says gallery carts use CC BY-NC-SA and explicitly allows their authors to release them elsewhere under a different license. The ISC registry release supplies that separate distribution basis here. Include [NOTICE.txt](NOTICE.txt) with the cartridge and new recovered-component exports. Preserve all recipient notices as well; this is not a blanket license for the project. Historical hash-bound packages are retained unchanged.

The registry metadata can be rechecked with a read-only GraphQL query at `https://registry.wasmer.io/graphql`:

```graphql
query {
  getPackageVersion(name: "willguimont/dashy-dango", version: "1.0.0") {
    version
    license
    manifest
    distribution { downloadUrl }
  }
}
```

No author endorsement is implied, and no courtesy message has been sent.
