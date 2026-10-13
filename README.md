# Gay Men History — website

Source of the live site **https://gaymenhistory.com** (a Vercel project, deployed from the files in this repo).

## What's here

| Path | What it is |
|---|---|
| `index.html` | The site itself (single page: book, shop, cart). This is what visitors see. |
| `assets/` | Images used by the page (logo, hero, author, decade images, cart thumbnail). |
| `uploads/` | Image library the page's image slots can use (book covers, author photos, mockups). |
| `support.js`, `image-slot.js` | Scripts used by the page. |
| `api/create-checkout-session.js` | Creates a Stripe Checkout session when the customer presses Checkout. **Product prices are defined here (server-side).** |
| `api/stripe-webhook.js` | Receives `checkout.session.completed` from Stripe, then emails the customer an order confirmation and emails the shop owner a "new order" notice (via Resend). |
| `api/join.js` | Newsletter sign-up: emails the shop owner the new subscriber (via Resend). |
| `design/` | Design sources (Claude Design prototypes). Reference only; not needed by the live page. |

## Environment variables (Vercel → Settings → Environment Variables)

See `.env.example`. Real values live only in Vercel — they are not in this repo.

- `STRIPE_SECRET_KEY` — Stripe API key used to create checkout sessions.
- `STRIPE_WEBHOOK_SECRET` — signing secret of the Stripe webhook endpoint (`https://gaymenhistory.com/api/stripe-webhook`, event `checkout.session.completed`).
- `RESEND_API_KEY` — Resend key used to send email.
- `RESEND_FROM_EMAIL` — sender address. It must be on a domain verified in Resend, otherwise Resend only delivers to the account owner.
- `NOTIFY_EMAIL` — where "new order" and "new subscriber" notices go (comma-separated allowed for orders).

## Changing a price

Prices exist in two places and must match:
1. `PRODUCTS` in `api/create-checkout-session.js` (this is what Stripe actually charges).
2. The product list inside `index.html` (what the cart and buttons display).

## Deploying

Pushing to `main` deploys to production once this repo is connected to the Vercel project
(Vercel → Project → Settings → Git). Other branches get a preview URL.
