# Pantrack coming-soon page

A standalone static holding page for `https://pantrack.app`. It follows
Pantrack's green branding and introduces the planned café inventory and
purchasing workspace. All preview quantities are fictional; the page labels
the illustration as a preview. No launch date is promised.

The deployable files are in [public](public). They need no build, framework,
database, environment variables, remote fonts, or JavaScript. There is no
email collection or waitlist service. The main link scrolls to the feature
overview.

## Upload through the Cloudflare dashboard

1. In Cloudflare, open **Workers & Pages** and create a **Pages** application
   using **Direct Upload / Drag and drop your files**.
2. Name it `pantrack-coming-soon` and upload the `public` folder or the generated
   `pantrack-coming-soon.zip`. `index.html` must be at the upload's root; do not
   upload this README, the Wrangler configuration, or the whole Pantrack repo.
3. Deploy and check the assigned `*.pages.dev` URL.
4. Open the Pages project, choose **Custom domains → Set up a domain**, and add
   `pantrack.app`. Use the Cloudflare account that holds the domain's active
   Cloudflare zone. Follow its DNS and certificate instructions and wait until
   the domain is active.
5. Verify `https://pantrack.app` on desktop and mobile. An unknown path such as
   `/missing` should return the styled 404 page. Check that the feature link
   works and the favicon loads.

If the hostname already points to a Worker or another site, review the existing
route and DNS record before switching it to this Pages project. Domain changes
affect the public site. Adding `www.pantrack.app` is optional and requires its
own custom-domain setup.

Cloudflare's [Direct Upload guide](https://developers.cloudflare.com/pages/get-started/direct-upload/)
supports uploading a folder or ZIP through the dashboard. A Direct Upload
project cannot later switch to Git integration; create a separate Git-connected
project if you want automatic deployments. See also the
[Pages custom-domain guide](https://developers.cloudflare.com/pages/configuration/custom-domains/).

## Alternative: a separate static-assets Worker

From the **Pantrack repository root**, use the existing Wrangler dependency and
the explicitly isolated configuration:

```sh
pnpm exec wrangler dev --config sites/coming-soon/wrangler.jsonc --ip 127.0.0.1 --port 8788 --inspector-port 0
```

After local review, these commands log in and publish **only the coming-soon
Worker**. Run them when you intend to deploy:

```sh
pnpm exec wrangler login
pnpm exec wrangler deploy --config sites/coming-soon/wrangler.jsonc
```

Check its `*.workers.dev` URL, then open the `pantrack-coming-soon` Worker in
Cloudflare and choose **Settings → Domains & Routes → Add → Custom Domain**.
Add `pantrack.app` and follow the prompts. This configuration has no domain
route, application code, database binding, or secrets. It creates a separate
Worker from `pantrack-dev`.

Do not use the repository's `pnpm deploy:dev` command for this page: that
publishes the development application. See Cloudflare's
[static-assets guide](https://developers.cloudflare.com/workers/static-assets/get-started/)
and [Worker custom-domain guide](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## Package or update

The `public` folder is already the complete deployment artifact. To recreate
the dashboard ZIP from the repository root using Python 3:

```sh
python3 - <<'PY'
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

source = Path('sites/coming-soon/public')
output = Path('outputs/pantrack-coming-soon.zip')
output.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(output, 'w', ZIP_DEFLATED) as bundle:
    for asset in sorted(source.iterdir()):
        if asset.is_file():
            bundle.write(asset, asset.name)
print(output)
PY
```

Edit [index.html](public/index.html) for copy and [styles.css](public/styles.css)
for appearance. Upload the full folder or ZIP as a new deployment. Keep the
canonical URL, social metadata, [robots.txt](public/robots.txt), and
[sitemap.xml](public/sitemap.xml) aligned if changing the domain.

## Scope and rollback

This is a C2 platform follow-up artifact, not a new milestone acceptance or a
production release of the application. It changes no application behavior,
API, schema, migrations, integration gates, or purchasing controls. The next
unblocked page step is to upload the artifact and attach the domain in
Cloudflare; the platform roadmap's open C3 decisions remain separate.

No Cloudflare deployment, DNS change, or live integration is performed by
creating these files. Local checks do not prove hosted DNS or certificate
behavior. To undo a published page change, roll back to an earlier deployment.
When the application is ready for a separately authorized release, reassign
the custom domain to that release and retain the holding-page project for
rollback.

## Local verification — 2026-09-30

- `pnpm typecheck` — passed.
- `pnpm test` — all 32 existing test suites passed.
- `pnpm build` — the existing application build passed.
- `pnpm exec wrangler deploy --dry-run --config sites/coming-soon/wrangler.jsonc --outdir outputs/coming-soon-worker-check`
  — passed with seven static assets and no bindings; nothing published.
- Local Wrangler HTTP checks — the homepage, CSS, favicon, robots, and sitemap
  returned 200 with the expected content types and security headers; an unknown
  path returned the custom page with status 404.
- Safari visual review — desktop and 320, 390, and 768 pixel viewports inspected;
  the narrow layouts were reviewed in local fixed-width frames. The stock-card
  illustration's fictional sample data remained separate from application data.
- Local asset/anchor and Markdown relative-link checks, XML validation with
  `xmllint`, ZIP integrity/source comparison, and `git diff --check` — passed.

No schema or application files changed, so database migration and application
HTTP smoke commands were outside this static-page slice. Hosted deployment,
custom-domain DNS, TLS, and real-device mobile checks remain external steps.
