# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Defeat Watch

The standalone defeat alert app is served from `/defeat-alert/`.

- Public status: `/defeat-alert/`
- Private device management: stored as a random token in that browser only
- Hidden admin view: `/defeat-alert/admin`
- Monitor: `monitor-defeats` runs every minute through Netlify Scheduled Functions

Deployment setup:

1. Run `supabase/defeat-alerts.sql` for a new database, or
   `supabase/defeat-push-migration.sql` for an existing Defeat Watch database.
2. Generate a VAPID key pair and add `VAPID_PUBLIC_KEY` and
   `VAPID_PRIVATE_KEY` to the staff Netlify site's environment variables.
3. Add `DEFEAT_ADMIN_TOKEN` to protect the hidden nickname-only admin view.
4. Deploy the site. The first scheduled monitor run populates the public status.

Browser push endpoints and encryption keys stay in server-only RLS tables.
Public and admin APIs return nicknames and alert state only.

For a separate Netlify address using the same repository, set
`VITE_APP_MODE=defeat`, `VITE_DEFEAT_API_BASE=/defeat-api`, and
`DEFEAT_MONITOR_ENABLED=false` on the second site. The standalone frontend then
uses the staff site's API and does not need copies of its Gmail or Supabase
secrets. Push notifications open the standalone public origin.

### Browser push notifications

The current registration flow uses browser Web Push rather than email. Run
`supabase/defeat-push-migration.sql` once, then add `VAPID_PUBLIC_KEY` and
`VAPID_PRIVATE_KEY` to the staff Netlify site's environment variables. Generate
a stable key pair with `npx web-push generate-vapid-keys --json`; changing that
pair later requires users to subscribe again. Push endpoints and encryption keys
remain in server-only RLS tables, while each device keeps its own management
token in local storage.
