import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Social preview tags, injected at build time.
 *
 * og:image has to be an absolute URL and crawlers read it out of the served
 * HTML without running JavaScript, so it cannot come from the app the way the
 * runtime env does (see docker/web-entrypoint.sh) — it has to exist in the
 * bytes this build emits. That also means Vite's %VITE_X% substitution is the
 * wrong tool here: with VITE_SITE_URL unset it leaves the literal placeholder in
 * the tag rather than falling back to anything.
 *
 * So the tags are written here instead. With VITE_SITE_URL set (production, and
 * it must match DOMAIN_LANDING in the nginx template) the image resolves to an
 * absolute URL. Without it, they are dropped entirely rather than emitted with
 * a root-relative path that no crawler would resolve: a link with no preview
 * beats a link whose preview is broken.
 */
const TITLE = 'PuntoFarma — POS para droguerías colombianas';
const DESCRIPTION =
  'La caja que no se detiene cuando se va internet. Facturación DIAN, control de lotes INVIMA y licencia mensual sin contrato.';
const IMAGE_ALT =
  'La caja que no se detiene cuando se va internet. Licencia POS para droguerías, $ 199.000 al mes.';

function socialPreview(siteUrl: string | undefined): Plugin {
  const origin = siteUrl?.replace(/\/+$/, '');

  return {
    name: 'punto-farma-social-preview',
    transformIndexHtml(html) {
      if (!origin) return html;

      const tags = [
        ['property', 'og:url', `${origin}/`],
        ['property', 'og:image', `${origin}/og-image.png`],
        ['property', 'og:image:type', 'image/png'],
        ['property', 'og:image:width', '1200'],
        ['property', 'og:image:height', '630'],
        ['property', 'og:image:alt', IMAGE_ALT],
        ['name', 'twitter:card', 'summary_large_image'],
        ['name', 'twitter:title', TITLE],
        ['name', 'twitter:description', DESCRIPTION],
        ['name', 'twitter:image', `${origin}/og-image.png`],
      ]
        .map(
          ([attr, key, content]) =>
            `<meta ${attr}="${key}" content="${content}" />`,
        )
        .join('\n    ');

      return html.replace(
        '<!-- social-preview -->',
        tags,
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  // loadEnv is what makes the build arg reach a plugin; import.meta.env is only
  // populated for client code.
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  return {
    plugins: [react(), tailwindcss(), socialPreview(env.VITE_SITE_URL)],
    server: {
      // Backoffice owns 5173; the server's CORS allowlist is origin-based, so a
      // silent port bump breaks every checkout call.
      port: 5174,
      strictPort: true,
    },
  };
});