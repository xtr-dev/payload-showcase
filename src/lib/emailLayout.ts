import type { EmailLayout } from '@xtr-dev/payload-mailing'

/**
 * The Kiln & Co. email layout, registered with payload-mailing as the default layout.
 *
 * The plugin renders a template's rich text, then injects it at `{{ content }}`. Every other
 * `{{ }}` here is a template variable (see `baseVariables()` in ./mailing.ts) and is
 * HTML-escaped by the plugin. Email clients ignore external CSS and web fonts, so the styles are
 * inline, the structure is table-based, and the brand fonts fall back to Georgia and system sans.
 * Colours mirror src/styles/tokens.css: paper, bisque, ink, ink-soft, clay and ochre.
 */
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Kiln &amp; Co.</title>
<style>
  .kc-body h1, .kc-body h2, .kc-body h3 { font-family: Georgia, 'Iowan Old Style', serif; color: #2b1f18; font-weight: 600; line-height: 1.25; margin: 0 0 12px; }
  .kc-body h1 { font-size: 28px; } .kc-body h2 { font-size: 24px; } .kc-body h3 { font-size: 20px; }
  .kc-body p, .kc-body li { font-size: 16px; line-height: 1.6; color: #2b1f18; margin: 0 0 14px; }
  .kc-body ul, .kc-body ol { padding-left: 22px; margin: 0 0 14px; }
  .kc-body a { color: #a8461f; font-weight: 600; }
  .kc-body blockquote { margin: 0 0 14px; padding: 12px 16px; background: #f1e6d6; border-left: 4px solid #d9a441; border-radius: 8px; }
  @media (max-width: 620px) { .kc-card { padding: 24px !important; } }
</style>
</head>
<body style="margin:0;padding:0;background:#faf5ec;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{{ preheader }}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf5ec;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
      <tr><td style="padding:0 8px 20px;font-family:Georgia,'Iowan Old Style',serif;">
        <a href="{{ siteUrl }}" style="text-decoration:none;color:#2b1f18;">
          <span style="display:inline-block;width:14px;height:22px;border-radius:7px 7px 3px 3px;background:#d9a441;vertical-align:-3px;margin-right:8px;"></span><span style="font-size:24px;font-weight:600;">Kiln &amp; Co.</span>
        </a>
        <span style="display:block;margin-top:4px;font-family:'Helvetica Neue',Arial,sans-serif;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#a8461f;">Ceramics studio by the sea</span>
      </td></tr>
      <tr><td class="kc-card kc-body" style="background:#ffffff;border:1px solid #d8c4a8;border-radius:20px;padding:36px;font-family:'Helvetica Neue',Arial,sans-serif;color:#2b1f18;">
        {{ content }}
      </td></tr>
      <tr><td style="padding:24px 8px 0;font-family:'Helvetica Neue',Arial,sans-serif;font-size:13px;line-height:1.6;color:#5b4637;">
        Kiln &amp; Co. · Strandweg 12, Zandvoort aan Zee · <a href="mailto:hello@kiln.test" style="color:#5b4637;">hello@kiln.test</a><br>
        You get this email because of your account at <a href="{{ siteUrl }}" style="color:#5b4637;">Kiln &amp; Co.</a>
        Manage your email settings in <a href="{{ siteUrl }}/account#settings" style="color:#5b4637;">My studio</a>.
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`

const text = `KILN & CO. · Ceramics studio by the sea

{{ content }}

--
Kiln & Co. · Strandweg 12, Zandvoort aan Zee · hello@kiln.test
Manage your email settings: {{ siteUrl }}/account#settings`

export const kilnEmailLayout: EmailLayout = { html, text }
