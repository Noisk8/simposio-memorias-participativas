import { randomBytes } from 'node:crypto';

export type AccountInviteInput = {
  email: string;
  name?: string;
  password: string;
  role: string;
  loginUrl?: string;
};

export type AccountInviteEmailResult = {
  sent: boolean;
  provider: 'resend' | 'none';
  reason?: string;
  messageId?: string;
};

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Superadministración',
  admin: 'Administración',
  editor: 'Edición',
  reviewer: 'Revisión',
  author: 'Autoría',
  read_only: 'Solo lectura',
};

const PASSWORD_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*?';
const DEFAULT_LOGIN_PATH = '/admin/login';
const DEFAULT_SITE_ORIGIN = 'https://simposio-memorias-participativas.netlify.app';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function envValue(key: string): string {
  return String(process.env[key] || '').trim();
}

export function generateTemporaryPassword(length = 16): string {
  const size = Math.max(12, Math.min(32, Math.floor(length)));
  const bytes = randomBytes(size);
  let password = '';
  for (let index = 0; index < size; index += 1) {
    password += PASSWORD_CHARSET[bytes[index] % PASSWORD_CHARSET.length];
  }
  return password;
}

export function buildAccountInviteEmail(input: AccountInviteInput) {
  const loginUrl = input.loginUrl || `${envValue('SITE_URL') || envValue('URL') || DEFAULT_SITE_ORIGIN}${DEFAULT_LOGIN_PATH}`;
  const name = input.name?.trim() || input.email;
  const roleLabel = ROLE_LABELS[input.role] || input.role;
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(input.email);
  const safePassword = escapeHtml(input.password);
  const safeRole = escapeHtml(roleLabel);
  const safeLoginUrl = escapeHtml(loginUrl);

  return {
    subject: `Acceso al panel del simposio: ${roleLabel}`,
    text: [
      `Hola ${name},`,
      '',
      'Tu cuenta para el panel administrativo del Simposio de Memorias Participativas ya fue creada.',
      '',
      `Correo: ${input.email}`,
      `Contraseña temporal: ${input.password}`,
      `Rol inicial: ${roleLabel}`,
      `Acceso al panel: ${loginUrl}`,
      '',
      'Cambia la contraseña después de iniciar sesión por primera vez.',
    ].join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
        <h2 style="margin: 0 0 12px; color: #175486;">Acceso al panel del simposio</h2>
        <p style="margin: 0 0 16px;">Hola ${safeName},</p>
        <p style="margin: 0 0 16px;">
          Tu cuenta para el panel administrativo del Simposio de Memorias Participativas ya fue creada.
        </p>
        <table style="border-collapse: collapse; width: 100%; max-width: 560px;">
          <tbody>
            <tr>
              <td style="padding: 8px 0; font-weight: 700; width: 180px;">Correo</td>
              <td style="padding: 8px 0;">${safeEmail}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: 700;">Contraseña temporal</td>
              <td style="padding: 8px 0;"><code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;">${safePassword}</code></td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: 700;">Rol inicial</td>
              <td style="padding: 8px 0;">${safeRole}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: 700;">Acceso al panel</td>
              <td style="padding: 8px 0;"><a href="${safeLoginUrl}">${safeLoginUrl}</a></td>
            </tr>
          </tbody>
        </table>
        <p style="margin: 18px 0 0;">
          Cambia la contraseña después de iniciar sesión por primera vez.
        </p>
      </div>
    `.trim(),
    loginUrl,
    roleLabel,
  };
}

export async function sendAccountInviteEmail(
  input: AccountInviteInput
): Promise<AccountInviteEmailResult> {
  const apiKey = envValue('RESEND_API_KEY');
  const from = envValue('RESEND_FROM_EMAIL') || envValue('MAIL_FROM');

  if (!apiKey || !from) {
    return { sent: false, provider: 'none', reason: 'not_configured' };
  }

  const email = buildAccountInviteEmail(input);
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [input.email],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return {
        sent: false,
        provider: 'resend',
        reason: `${response.status} ${response.statusText}${detail ? `: ${detail.slice(0, 180)}` : ''}`,
      };
    }

    const payload = await response.json().catch(() => ({}));
    return {
      sent: true,
      provider: 'resend',
      messageId: typeof payload?.id === 'string' ? payload.id : undefined,
    };
  } catch (error) {
    return {
      sent: false,
      provider: 'resend',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
