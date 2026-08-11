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
- Private subscriber management: delivered through an email magic link
- Hidden admin view: `/defeat-alert/admin`
- Monitor: `monitor-defeats` runs every minute through Netlify Scheduled Functions

Deployment setup:

1. Run `supabase/defeat-alerts.sql` once in the Supabase SQL Editor.
2. Enable two-step verification on the dedicated Gmail account and create an
   app password.
3. Add `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `DEFEAT_FROM_NAME`,
   `DEFEAT_LINK_SECRET`, and `DEFEAT_ADMIN_TOKEN` to the Netlify environment
   variables. `DEFEAT_SITE_URL` is optional when using the default Netlify URL.
4. Deploy the site. The first scheduled monitor run populates the public status.

Subscriber email addresses stay in server-only RLS tables. Public and admin APIs
return nicknames and alert state only.

For a separate Netlify address using the same repository, set
`VITE_APP_MODE=defeat`, `VITE_DEFEAT_API_BASE=/defeat-api`, and
`DEFEAT_MONITOR_ENABLED=false` on the second site. The standalone frontend then
uses the staff site's API and does not need copies of its Gmail or Supabase
secrets. Set `DEFEAT_SITE_URL` only on the staff site to the standalone site's
public origin so email links open the standalone app.
