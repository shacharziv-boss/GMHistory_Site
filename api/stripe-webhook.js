const crypto = require('crypto');

module.exports.config = { api: { bodyParser: false } };

const RESEND_API_URL = 'https://api.resend.com/emails';

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function isValidStripeSignature(rawBody, sigHeader, secret, toleranceSeconds = 300) {
  if (!sigHeader) return false;
  const parts = {};
  for (const piece of sigHeader.split(',')) {
    const [k, v] = piece.split('=');
    if (k && v) parts[k] = v;
  }
  const { t: timestamp, v1: signature } = parts;
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');

  const sigBuf = Buffer.from(signature, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;

  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  return age <= toleranceSeconds;
}

async function sendEmail({ apiKey, from, to, subject, html, text }) {
  const resp = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  if (!resp.ok) {
    console.error('Resend API error:', resp.status, await resp.text());
  }
}

async function fetchFullSession(sessionId) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey || !sessionId) return null;
  try {
    const url = `https://api.stripe.com/v1/checkout/sessions/${sessionId}?expand[]=line_items`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (!resp.ok) {
      console.error('Failed to retrieve full checkout session:', resp.status, await resp.text());
      return null;
    }
    return await resp.json();
  } catch (err) {
    console.error('Error retrieving full checkout session:', err);
    return null;
  }
}

function formatAddress(addr) {
  if (!addr) return '';
  return [addr.line1, addr.line2, [addr.city, addr.state, addr.postal_code].filter(Boolean).join(', '), addr.country]
    .filter(Boolean)
    .join(', ');
}

function formatLineItems(lineItems) {
  const items = (lineItems && lineItems.data) || [];
  return items
    .map((li) => `${li.description} × ${li.quantity} — $${((li.amount_total || 0) / 100).toFixed(2)}`)
    .join('\n');
}

async function sendOrderEmails(session) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('Missing RESEND_API_KEY — skipping order emails.');
    return;
  }
  const from = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

  // The webhook payload is often "thin" — re-fetch the full session (with
  // line items expanded) so the owner notification has complete details.
  const full = await fetchFullSession(session.id);
  if (full) session = full;

  const customerDetails = session.customer_details || {};
  const customerEmail = customerDetails.email || session.customer_email || '';
  const customerName = customerDetails.name || '';
  const customerPhone = customerDetails.phone || '';
  const shippingDetails = session.shipping_details || session.shipping || {};
  const shippingName = shippingDetails.name || customerName;
  const shippingAddress = formatAddress(shippingDetails.address);
  const billingAddress = formatAddress(customerDetails.address);
  const itemsText = formatLineItems(session.line_items);
  const shippingCost = session.shipping_cost ? ((session.shipping_cost.amount_total || 0) / 100).toFixed(2) : null;

  console.log('sendOrderEmails: orderId=', session.id, 'customerEmail=', customerEmail || '(none found)');

  const amountTotal = ((session.amount_total || 0) / 100).toFixed(2);
  const orderId = session.id;
  const orderNumber = 'GMH-' + orderId.replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase();

  const sends = [];

  if (customerEmail) {
    sends.push(sendEmail({
      apiKey,
      from,
      to: [customerEmail],
      subject: 'Your Gay Men History order is confirmed',
      html: `<p>Thank you for your order — and for celebrating queer history, love, and beauty with us.</p><p>Order number: <strong>${orderNumber}</strong></p><p>We'll send shipping updates to this email.</p><p>Questions about your order? Reach out to Shiko directly at <a href="mailto:shikovun@gmail.com">shikovun@gmail.com</a>.</p>`,
      text: `Thank you for your order — and for celebrating queer history, love, and beauty with us.\nOrder number: ${orderNumber}\n\nQuestions about your order? Reach out to Shiko directly at shikovun@gmail.com.`,
    }));
  }

  const notifyEmailRaw = process.env.NOTIFY_EMAIL;
  if (notifyEmailRaw) {
    const notifyEmails = notifyEmailRaw.split(',').map((s) => s.trim()).filter(Boolean);
    if (notifyEmails.length) {
      const detailRows = [
        ['Order number', orderNumber],
        ['Amount paid', `$${amountTotal}`],
        ['Items', itemsText || 'n/a'],
        ['Shipping cost', shippingCost !== null ? `$${shippingCost}` : 'n/a'],
        ['Customer name', shippingName || customerName || 'n/a'],
        ['Email', customerEmail || 'n/a'],
        ['Phone', customerPhone || 'n/a'],
        ['Shipping address', shippingAddress || 'n/a'],
        ['Billing address', billingAddress || 'n/a'],
        ['Stripe session', orderId],
      ];
      const htmlRows = detailRows
        .map(([label, value]) => `<tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap;">${label}</td><td style="padding:4px 0;white-space:pre-line;"><strong>${value}</strong></td></tr>`)
        .join('');
      const textRows = detailRows.map(([label, value]) => `${label}: ${value}`).join('\n');

      sends.push(sendEmail({
        apiKey,
        from,
        to: notifyEmails,
        subject: `New order ${orderNumber} — $${amountTotal}`,
        html: `<p>New paid order.</p><table>${htmlRows}</table>`,
        text: `New paid order.\n${textRows}`,
      }));
    }
  }

  await Promise.all(sends);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('Missing STRIPE_WEBHOOK_SECRET environment variable.');
    return res.status(500).end();
  }

  const rawBodyBuf = await getRawBody(req);
  const rawBody = rawBodyBuf.toString('utf8');
  const sig = req.headers['stripe-signature'];

  if (!isValidStripeSignature(rawBody, sig, secret)) {
    console.error('Invalid Stripe webhook signature.');
    return res.status(400).send('Invalid signature');
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    return res.status(400).send('Invalid payload');
  }

  if (event.type === 'checkout.session.completed') {
    try {
      await sendOrderEmails(event.data.object);
    } catch (err) {
      console.error('Failed to send order emails:', err);
    }
  }

  return res.status(200).json({ received: true });
};
