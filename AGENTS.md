# Agent notes

Read `README.md` first. This file lists constraints and lessons that aren't obvious from the code.

## Sources

- Amp self-hosted orbs and the dispatch contract: https://ampcode.com/docs/orbs/self-hosted
- Vercel Daemons: https://vercel.com/docs/daemons (configuration reference and limits pages)
- Sandbox SDK types: `provider/node_modules/@vercel/sandbox/dist/sandbox.d.ts`

## Rules

- Never commit secrets. `.env*` and `.vercel` are gitignored. Don't print token values.
- `dispatch.mjs` authenticates only with OIDC. Don't add Vercel access token support: SDK calls pass no credentials, and the VCR lookup uses `getVercelOidcToken()`.
- Every dispatch operation must be safe to repeat and finish within five minutes.
- Run `npm run check` in `provider/` after changing `dispatch.mjs`.

## Lessons learned

- A daemon with zero instances is still built and pushed to VCR as `daemon.<name>`. That's how `orb-image` copies Amp's image without Docker.
- Daemon images are tagged with the deployment ID only. There's no `latest` tag, so the bare reference `daemon.orb-image` returns `404 Image not found`. `dispatch.mjs` lists the repository's images and pins the newest ready one by digest.
- Vercel doesn't pass system variables such as `VERCEL_DEPLOYMENT_ID` to daemon builds as build arguments, and daemon OIDC tokens have no deployment claim.
- The VCR images endpoint (`GET /v1/vcr/repository/{name}/images`) accepts the project's OIDC token. The team and project IDs come from its `owner_id` and `project_id` claims.
- `Sandbox.getOrCreate()` ignores new settings for an existing sandbox. If you change the snapshot policy or resources, existing orbs need `sandbox.update()`.
- Stopping a sandbox saves a snapshot, and `sandbox.delete()` doesn't delete snapshots. Delete them explicitly after tests.
- A stopped persistent sandbox whose snapshot expired can't resume: SDK calls fail with `410 snapshot_not_found`, and Vercel removes it only after 14 days. `spawn` checks the current snapshot and recreates the orb when it's gone.
- The Amp CLI needs a glibc base image, such as Debian. It doesn't run on Alpine.
- Daemon logs aren't available through `vercel logs`. Check them in the dashboard, or write results somewhere you can read, such as sandbox tags.

## Verification

- Test `dispatch.mjs` locally against the linked project's development OIDC token:

  ```sh
  cd provider
  export ORB_ID=amp-dispatch-test-$(date +%s) ORB_TOKEN=fake
  for op in spawn spawn pause delete delete; do ORB_OPERATION=$op node --env-file=../.env.local dispatch.mjs; done
  ```

  Then confirm that no sandboxes or snapshots remain.
