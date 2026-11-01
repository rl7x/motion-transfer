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

The pinned package metadata declares ISC, while the game's WASM-4 gallery page displays CC BY-NC-SA. The applicable permissions and notices need to be resolved before publishing the cartridge or derived assets. This download does not change their licensing.
