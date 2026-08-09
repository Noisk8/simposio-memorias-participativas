import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAccountInviteEmail,
  generateTemporaryPassword,
  sendAccountInviteEmail,
} from '../shared/users/account-invite.ts';

test('generateTemporaryPassword: crea claves temporales de longitud segura', () => {
  const password = generateTemporaryPassword(18);
  assert.equal(password.length, 18);
  assert.match(password, /^[A-Za-z0-9!@#$%*?]+$/);
});

test('buildAccountInviteEmail: incorpora credenciales y enlace al panel', () => {
  const email = buildAccountInviteEmail({
    email: 'usuario@example.com',
    name: 'Usuario Demo',
    password: 'Abc12345!!',
    role: 'admin',
    loginUrl: 'https://simposio.example/admin/login',
  });

  assert.equal(email.roleLabel, 'Administración');
  assert.match(email.subject, /Acceso al panel/);
  assert.match(email.text, /usuario@example\.com/);
  assert.match(email.text, /Abc12345!!/);
  assert.match(email.html, /Usuario Demo/);
  assert.match(email.html, /simposio\.example\/admin\/login/);
});

test('sendAccountInviteEmail: no envía nada si faltan variables de correo', async () => {
  const previousResendKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.RESEND_FROM_EMAIL;
  const previousMailFrom = process.env.MAIL_FROM;

  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.MAIL_FROM;

  try {
    const result = await sendAccountInviteEmail({
      email: 'usuario@example.com',
      name: 'Usuario Demo',
      password: 'Abc12345!!',
      role: 'author',
    });

    assert.deepEqual(result, {
      sent: false,
      provider: 'none',
      reason: 'not_configured',
    });
  } finally {
    if (previousResendKey !== undefined) process.env.RESEND_API_KEY = previousResendKey;
    else delete process.env.RESEND_API_KEY;
    if (previousFrom !== undefined) process.env.RESEND_FROM_EMAIL = previousFrom;
    else delete process.env.RESEND_FROM_EMAIL;
    if (previousMailFrom !== undefined) process.env.MAIL_FROM = previousMailFrom;
    else delete process.env.MAIL_FROM;
  }
});
