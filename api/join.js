const RESEND_API_URL = 'https://api.resend.com/emails';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  return EMAIL_PATTERN.test(trimmed);
}

function escapeHtml(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (err) {
      return res.status(400).json({ success: false, error: 'Invalid request body.' });
    }
  }

  const email = body && typeof body.email === 'string' ? body.email.trim() : '';

  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const notifyEmailRaw = process.env.NOTIFY_EMAIL;

  if (!apiKey || !notifyEmailRaw) {
    console.error('Missing RESEND_API_KEY or NOTIFY_EMAIL environment variable.');
    return res.status(500).json({ success: false, error: 'Server is not configured. Please try again later.' });
  }

  const notifyEmails = notifyEmailRaw
    .split(',')
    .map((addr) => addr.trim())
    .filter((addr) => addr.length > 0);

  if (notifyEmails.length === 0) {
    console.error('NOTIFY_EMAIL environment variable has no valid addresses.');
    return res.status(500).json({ success: false, error: 'Server is not configured. Please try again later.' });
  }

  const submittedAt = new Date();
  const formatted = submittedAt.toLocaleString('en-US', { timeZoneName: 'short' });

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
        to: notifyEmails,
        subject: 'New newsletter signup',
        text: `Subscriber email: ${email}\nDate and time: ${formatted}`,
        html: `<p><strong>Subscriber email:</strong> ${escapeHtml(email)}</p><p><strong>Date and time:</strong> ${formatted}</p>`,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Resend API error:', response.status, errText);
      return res.status(502).json({ success: false, error: 'Could not send notification email. Please try again later.' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Newsletter join failed:', err);
    return res.status(500).json({ success: false, error: 'Unexpected server error. Please try again later.' });
  }
};
