const STRIPE_API = 'https://api.stripe.com/v1/checkout/sessions';

// Server-side price catalog — never trust prices sent from the client.
const PRODUCTS = {
  book: { name: 'Gay Men History — Hardcover', price: 1 },
  mug: { name: 'Mug', price: 28 },
  poster: { name: 'Poster', price: 38 },
  candle: { name: 'Candle', price: 24 },
  towel: { name: 'Towel', price: 32 },
};

const SITE_URL = 'https://gaymenhistory.com';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid request body.' });
    }
  }

  const items = Array.isArray(body && body.items) ? body.items : [];
  if (items.length === 0) {
    return res.status(400).json({ error: 'Your cart is empty.' });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.error('Missing STRIPE_SECRET_KEY environment variable.');
    return res.status(500).json({ error: 'Server is not configured.' });
  }

  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('success_url', `${SITE_URL}/?order=success&session_id={CHECKOUT_SESSION_ID}`);
  params.append('cancel_url', `${SITE_URL}/?order=cancelled`);
  params.append('phone_number_collection[enabled]', 'true');
  params.append('customer_creation', 'always');
  params.append('billing_address_collection', 'required');

  ['US', 'CA', 'GB', 'IE', 'AU', 'NZ', 'IL', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'SE', 'NO', 'DK', 'FI'].forEach((c, i) => {
    params.append(`shipping_address_collection[allowed_countries][${i}]`, c);
  });

  params.append('shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
  params.append('shipping_options[0][shipping_rate_data][fixed_amount][amount]', '0');
  params.append('shipping_options[0][shipping_rate_data][fixed_amount][currency]', 'usd');
  params.append('shipping_options[0][shipping_rate_data][display_name]', 'Standard (5–7 days) — Free');

  params.append('shipping_options[1][shipping_rate_data][type]', 'fixed_amount');
  params.append('shipping_options[1][shipping_rate_data][fixed_amount][amount]', '1500');
  params.append('shipping_options[1][shipping_rate_data][fixed_amount][currency]', 'usd');
  params.append('shipping_options[1][shipping_rate_data][display_name]', 'Express (2–3 days)');

  const email = body && typeof body.email === 'string' ? body.email.trim() : '';
  if (email && EMAIL_PATTERN.test(email)) {
    params.append('customer_email', email);
  }

  let idx = 0;
  for (const item of items) {
    const product = PRODUCTS[item && item.id];
    if (!product) continue;
    const qty = Math.max(1, Math.min(20, parseInt(item && item.qty, 10) || 1));
    params.append(`line_items[${idx}][quantity]`, String(qty));
    params.append(`line_items[${idx}][price_data][currency]`, 'usd');
    params.append(`line_items[${idx}][price_data][unit_amount]`, String(Math.round(product.price * 100)));
    params.append(`line_items[${idx}][price_data][product_data][name]`, product.name);
    idx++;
  }

  if (idx === 0) {
    return res.status(400).json({ error: 'No valid items in cart.' });
  }

  try {
    const stripeRes = await fetch(STRIPE_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const session = await stripeRes.json();

    if (!stripeRes.ok) {
      console.error('Stripe checkout session error:', session);
      return res.status(502).json({ error: 'Could not start checkout. Please try again.' });
    }

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout session creation failed:', err);
    return res.status(500).json({ error: 'Unexpected server error. Please try again later.' });
  }
};
