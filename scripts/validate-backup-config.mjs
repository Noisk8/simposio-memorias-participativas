import { X509Certificate } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

// Never print values: this process runs with production credentials in Actions.
const required = [
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_PROJECT_ID',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'BACKUP_ENCRYPTION_KEY',
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_FORCE_PATH_STYLE',
  'S3_PUBLIC_BASE_URL',
  'S3_BACKUP_BUCKET',
];

try {
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length)
    throw new Error(`Faltan secretos de production-backup: ${missing.join(', ')}.`);
  if (process.env.BACKUP_ENCRYPTION_KEY.length < 32)
    throw new Error('BACKUP_ENCRYPTION_KEY debe tener al menos 32 caracteres aleatorios.');
  if (process.env.S3_BUCKET !== 'cms-media' || process.env.S3_FORCE_PATH_STYLE !== 'true')
    throw new Error('Se requiere S3_BUCKET=cms-media y S3_FORCE_PATH_STYLE=true.');
  if (process.env.S3_BACKUP_BUCKET === process.env.S3_BUCKET)
    throw new Error('S3_BACKUP_BUCKET debe ser privado y distinto al bucket de medios.');
  for (const name of ['SUPABASE_URL', 'S3_ENDPOINT', 'S3_PUBLIC_BASE_URL']) {
    let url;
    try {
      url = new URL(process.env[name]);
    } catch {
      throw new Error(`${name} debe ser una URL HTTPS válida.`);
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw new Error(`${name} debe ser HTTPS, sin credenciales, query ni fragmento.`);
  }
  const pem = process.env.S3_CA_CERT_PEM;
  if (pem?.trim()) {
    const certificates = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    if (!certificates?.length || /PRIVATE KEY/.test(pem))
      throw new Error('S3_CA_CERT_PEM debe contener certificados PEM, nunca claves privadas.');
    try {
      for (const certificate of certificates) {
        const parsed = new X509Certificate(certificate);
        if (Date.parse(parsed.validFrom) > Date.now() || Date.parse(parsed.validTo) <= Date.now())
          throw new Error();
      }
    } catch {
      throw new Error('S3_CA_CERT_PEM contiene un certificado inválido o fuera de vigencia.');
    }
    if (!process.env.BACKUP_CA_FILE) throw new Error('Falta BACKUP_CA_FILE para preparar TLS.');
    await writeFile(process.env.BACKUP_CA_FILE, certificates.join('\n') + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
  }
  console.log(
    'Configuración de respaldo completo validada; la conexión se verificará al exportar.'
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
