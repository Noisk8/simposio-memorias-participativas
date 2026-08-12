import { createHash } from 'node:crypto';
import { access, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

export const CMS_MEDIA_BUCKET = 'cms-media';
export const LEGACY_REFERENCE_PATTERN =
  /(?<![A-Za-z0-9_-])\/(?:images|documents)\/[A-Za-z0-9][A-Za-z0-9._%+@/-]*/g;
const STORAGE_PUBLIC_MARKER = `/storage/v1/object/public/${CMS_MEDIA_BUCKET}/`;
const SOURCE_EXTENSIONS = new Set(['.md', '.mdx', '.astro', '.ts', '.tsx', '.js', '.jsx', '.css']);
const CONTENT_EXTENSIONS = new Set(['.md', '.mdx']);
const MAX_MEDIA_BYTES = 2 * 1024 * 1024;

const TYPES = {
  jpg: ['image/jpeg', 'image', 'images'],
  jpeg: ['image/jpeg', 'image', 'images'],
  png: ['image/png', 'image', 'images'],
  webp: ['image/webp', 'image', 'images'],
  pdf: ['application/pdf', 'document', 'documents'],
};

async function filesBelow(directory, acceptedExtensions) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return filesBelow(target, acceptedExtensions);
      return entry.isFile() && acceptedExtensions.has(path.extname(entry.name).toLowerCase())
        ? [target]
        : [];
    })
  );
  return nested.flat();
}

export function legacyReferences(source) {
  return [...new Set(source.match(LEGACY_REFERENCE_PATTERN) || [])].sort();
}

function safeFilename(filename, effectiveExtension = '') {
  const declaredExtension = path.extname(filename).slice(1).toLowerCase();
  const extension = effectiveExtension || declaredExtension;
  if (!TYPES[extension]) throw new Error(`Tipo no permitido: ${filename}`);
  const stem = filename
    .slice(0, -(declaredExtension.length + 1))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150 - extension.length);
  if (!stem) throw new Error(`Nombre inválido: ${filename}`);
  return `${stem}.${extension}`;
}

function objectPath(type, checksum, normalizedFilename, date = new Date()) {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${type[2]}/${year}/${month}/${checksum}-${normalizedFilename}`;
}

function storagePublicUrl(supabaseUrl, storagePath) {
  const encoded = storagePath.split('/').map(encodeURIComponent).join('/');
  return `${supabaseUrl.replace(/\/+$/, '')}${STORAGE_PUBLIC_MARKER}${encoded}`;
}

function hasExpectedSignature(extension, bytes) {
  if (extension === 'jpg' || extension === 'jpeg') {
    return bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  }
  if (extension === 'png') {
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (extension === 'gif')
    return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
  if (extension === 'webp') {
    return (
      bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  if (extension === 'avif') return bytes.subarray(4, 12).toString('ascii').includes('ftypavif');
  if (extension === 'svg') {
    const source = bytes.toString('utf8');
    return (
      /^(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(source.replace(/^\uFEFF/, '').trimStart()) &&
      !/<script\b|\son[a-z]+\s*=|javascript\s*:|<foreignObject\b/i.test(source)
    );
  }
  if (extension === 'pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  return false;
}

async function loadLocalEnvironment(projectRoot) {
  for (const filename of ['.env', '.env.local']) {
    try {
      process.loadEnvFile(path.join(projectRoot, filename));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function storageClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY. Solo se usan server-side.');
  }
  return {
    url,
    client: createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }),
  };
}

async function inspectLocalMedia(projectRoot, reference) {
  const decoded = decodeURIComponent(reference);
  const relative = decoded.replace(/^\//, '');
  const filePath = path.resolve(projectRoot, 'public', relative);
  const publicRoot = path.resolve(projectRoot, 'public') + path.sep;
  if (!filePath.startsWith(publicRoot)) throw new Error(`Referencia insegura: ${reference}`);
  try {
    await access(filePath);
  } catch {
    throw new Error(`Referencia rota: ${reference} (${path.relative(projectRoot, filePath)})`);
  }

  const bytes = await readFile(filePath);
  if (!bytes.length || bytes.length > MAX_MEDIA_BYTES) {
    throw new Error(`Tamaño fuera del límite de 2 MiB: ${reference}`);
  }
  const fileStat = await stat(filePath);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const originalFilename = path.basename(filePath);
  const declaredExtension = path.extname(originalFilename).slice(1).toLowerCase();
  const declaredType = TYPES[declaredExtension];
  if (!declaredType) throw new Error(`Tipo no permitido: ${reference}`);
  let effectiveExtension = declaredExtension;
  if (!hasExpectedSignature(declaredExtension, bytes)) {
    effectiveExtension =
      Object.keys(TYPES).find((candidate) => hasExpectedSignature(candidate, bytes)) || '';
  }
  const type = TYPES[effectiveExtension];
  if (!type || (effectiveExtension !== declaredExtension && type[1] !== declaredType[1])) {
    throw new Error(`Firma binaria incompatible con la extensión: ${reference}`);
  }
  const normalizedFilename = safeFilename(originalFilename, effectiveExtension);
  let width = null;
  let height = null;
  if (type[1] === 'image') {
    const metadata = await sharp(bytes, { animated: true }).metadata();
    width = metadata.width || null;
    height = metadata.height || null;
    if (!width || !height) throw new Error(`Dimensiones inválidas: ${reference}`);
  }
  return {
    reference,
    filePath,
    bytes,
    checksum,
    originalFilename,
    safeFilename: normalizedFilename,
    mimeType: type[0],
    mediaKind: type[1],
    declaredExtension,
    effectiveExtension,
    storagePath: objectPath(type, checksum, normalizedFilename, fileStat.mtime),
    width,
    height,
  };
}

async function collectReferences(projectRoot) {
  const sourceFiles = await filesBelow(path.join(projectRoot, 'src'), SOURCE_EXTENSIONS);
  const occurrences = new Map();
  const contentOccurrences = new Map();
  const documents = [];
  for (const filePath of sourceFiles.sort()) {
    const source = await readFile(filePath, 'utf8');
    const references = legacyReferences(source);
    if (CONTENT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
      documents.push({ filePath, source, references });
      for (const reference of references) {
        const files = contentOccurrences.get(reference) || [];
        files.push(filePath);
        contentOccurrences.set(reference, files);
      }
    }
    for (const reference of references) {
      const files = occurrences.get(reference) || [];
      files.push(filePath);
      occurrences.set(reference, files);
    }
  }
  return { occurrences, contentOccurrences, documents, sourceFiles };
}

async function activeRecordByChecksum(client, checksum) {
  const { data, error } = await client
    .from('cms_media')
    .select('*')
    .eq('storage_bucket', CMS_MEDIA_BUCKET)
    .eq('checksum_sha256', checksum)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`No se pudo consultar cms_media: ${error.message}`);
  return data;
}

async function deletedRecordByChecksum(client, checksum) {
  const { data, error } = await client
    .from('cms_media')
    .select('*')
    .eq('storage_bucket', CMS_MEDIA_BUCKET)
    .eq('checksum_sha256', checksum)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`No se pudo consultar cms_media eliminado: ${error.message}`);
  return data;
}

async function storedChecksum(client, storagePath) {
  const { data, error } = await client.storage.from(CMS_MEDIA_BUCKET).download(storagePath);
  if (error || !data) return null;
  return createHash('sha256')
    .update(Buffer.from(await data.arrayBuffer()))
    .digest('hex');
}

function duplicateError(error) {
  return (
    Number(error?.statusCode || error?.status) === 409 ||
    /duplicate|already exists|resource already exists/i.test(String(error?.message || ''))
  );
}

async function uploadAndRegister(client, supabaseUrl, item) {
  const existing = await activeRecordByChecksum(client, item.checksum);
  if (existing) {
    const checksum = await storedChecksum(client, existing.storage_path);
    if (checksum === item.checksum) return { record: existing, reused: true };
    if (checksum) throw new Error(`Checksum inesperado en Storage: ${existing.storage_path}`);
    const { error } = await client.storage
      .from(existing.storage_bucket)
      .upload(existing.storage_path, item.bytes, {
        contentType: existing.mime_type,
        cacheControl: '31536000',
        upsert: false,
      });
    if (error) throw new Error(`No se pudo reparar el objeto ausente: ${error.message}`);
    return { record: existing, reused: true };
  }

  const deleted = await deletedRecordByChecksum(client, item.checksum);
  if (deleted) {
    const checksum = await storedChecksum(client, deleted.storage_path);
    if (checksum && checksum !== item.checksum) {
      throw new Error(`Checksum inesperado en Storage: ${deleted.storage_path}`);
    }
    let uploadedNow = false;
    if (!checksum) {
      const { error } = await client.storage
        .from(deleted.storage_bucket)
        .upload(deleted.storage_path, item.bytes, {
          contentType: deleted.mime_type,
          cacheControl: '31536000',
          upsert: false,
        });
      if (error) throw new Error(`No se pudo restaurar el objeto eliminado: ${error.message}`);
      uploadedNow = true;
    }
    const { data, error } = await client
      .from('cms_media')
      .update({ deleted_at: null })
      .eq('id', deleted.id)
      .not('deleted_at', 'is', null)
      .select('*')
      .single();
    if (error) {
      if (uploadedNow) {
        await client.storage.from(deleted.storage_bucket).remove([deleted.storage_path]);
      }
      throw new Error(`No se pudo restaurar cms_media: ${error.message}`);
    }
    return { record: data, reused: true };
  }

  const { error: uploadError } = await client.storage
    .from(CMS_MEDIA_BUCKET)
    .upload(item.storagePath, item.bytes, {
      contentType: item.mimeType,
      cacheControl: '31536000',
      upsert: false,
    });
  let uploadedNow = !uploadError;
  if (uploadError) {
    if (!duplicateError(uploadError)) throw new Error(`Storage: ${uploadError.message}`);
    if ((await storedChecksum(client, item.storagePath)) !== item.checksum) {
      throw new Error(`Colisión de ruta en Storage: ${item.storagePath}`);
    }
    uploadedNow = false;
  }

  const record = {
    storage_bucket: CMS_MEDIA_BUCKET,
    storage_path: item.storagePath,
    public_url: storagePublicUrl(supabaseUrl, item.storagePath),
    original_filename: item.originalFilename,
    safe_filename: item.safeFilename,
    media_kind: item.mediaKind,
    mime_type: item.mimeType,
    size_bytes: item.bytes.length,
    width: item.width,
    height: item.height,
    checksum_sha256: item.checksum,
    created_by: null,
  };
  const { data, error } = await client.from('cms_media').insert(record).select('*').single();
  if (!error) return { record: data, reused: false };

  const raced = await activeRecordByChecksum(client, item.checksum);
  if (raced) {
    if (uploadedNow && raced.storage_path !== item.storagePath) {
      await client.storage.from(CMS_MEDIA_BUCKET).remove([item.storagePath]);
    }
    return { record: raced, reused: true };
  }
  if (uploadedNow) await client.storage.from(CMS_MEDIA_BUCKET).remove([item.storagePath]);
  throw new Error(`No se pudo registrar cms_media: ${error.message}`);
}

async function rewriteDocuments(documents, replacements) {
  let changed = 0;
  for (const document of documents) {
    let next = document.source;
    for (const reference of document.references) {
      const replacement = replacements.get(reference);
      if (replacement) next = next.split(reference).join(replacement);
    }
    if (next === document.source) continue;
    const temporary = `${document.filePath}.media-migration.tmp`;
    await writeFile(temporary, next, 'utf8');
    await rename(temporary, document.filePath);
    changed++;
  }
  return changed;
}

async function verifyReferences(projectRoot, client = null) {
  const { documents } = await collectReferences(projectRoot);
  const detectedUrls = new Set();
  const verifiedUrls = new Set();
  for (const document of documents) {
    for (const reference of document.references) await inspectLocalMedia(projectRoot, reference);
    const urls =
      document.source.match(
        /https?:\/\/[^\s)'"<>]+\/storage\/v1\/object\/public\/cms-media\/[^\s)'"<>]+/g
      ) || [];
    for (const url of urls) detectedUrls.add(url);
    if (!client) continue;
    for (const url of urls) {
      if (verifiedUrls.has(url)) continue;
      const { data, error } = await client
        .from('cms_media')
        .select('id, storage_bucket, storage_path, checksum_sha256')
        .eq('public_url', url)
        .is('deleted_at', null)
        .maybeSingle();
      if (error || !data) throw new Error(`URL de Storage sin metadata activa: ${url}`);
      if ((await storedChecksum(client, data.storage_path)) !== data.checksum_sha256) {
        throw new Error(`URL de Storage rota o con checksum distinto: ${url}`);
      }
      verifiedUrls.add(url);
    }
  }
  return { storageUrls: client ? verifiedUrls.size : detectedUrls.size };
}

export async function migrateMedia(projectRoot, options) {
  const discovered = await collectReferences(projectRoot);
  const references = [...discovered.contentOccurrences.keys()].sort();
  const media = [];
  for (const reference of references) media.push(await inspectLocalMedia(projectRoot, reference));

  const byChecksum = new Map();
  for (const item of media) {
    if (!byChecksum.has(item.checksum)) byChecksum.set(item.checksum, item);
  }
  console.log(
    `Detectados ${references.length} paths legacy, ${byChecksum.size} archivos únicos y ${discovered.documents.length} documentos Markdown/MDX.`
  );
  for (const item of byChecksum.values()) {
    const correction =
      item.declaredExtension === item.effectiveExtension
        ? ''
        : ` [legacy ${item.declaredExtension} normalizado a ${item.effectiveExtension}]`;
    console.log(`${item.reference} -> ${item.storagePath} (${item.checksum})${correction}`);
  }

  if (options.dryRun) {
    const verification = await verifyReferences(projectRoot);
    if (verification.storageUrls) {
      console.log(
        `Detectadas ${verification.storageUrls} URLs de Storage; su verificación remota requiere un modo con credenciales.`
      );
    }
    console.log('Dry-run completo: no se modificó Storage, PostgreSQL ni el contenido.');
    return { references, uploaded: 0, rewritten: 0 };
  }

  await loadLocalEnvironment(projectRoot);
  const { client, url } = storageClient();
  const recordsByChecksum = new Map();
  let uploaded = 0;
  for (const item of byChecksum.values()) {
    if (options.upload) {
      const result = await uploadAndRegister(client, url, item);
      recordsByChecksum.set(item.checksum, result.record);
      if (!result.reused) uploaded++;
    } else {
      const record = await activeRecordByChecksum(client, item.checksum);
      if (!record) throw new Error(`Falta migrar antes de reescribir: ${item.reference}`);
      if ((await storedChecksum(client, record.storage_path)) !== item.checksum) {
        throw new Error(
          `No se reescribirá contenido: el objeto está ausente o corrupto (${item.reference}).`
        );
      }
      recordsByChecksum.set(item.checksum, record);
    }
  }

  const replacements = new Map();
  for (const item of media) {
    const record = recordsByChecksum.get(item.checksum);
    if (record) replacements.set(item.reference, record.public_url);
  }
  const rewritten = options.rewriteContent
    ? await rewriteDocuments(discovered.documents, replacements)
    : 0;
  const verification = await verifyReferences(projectRoot, client);

  const after = await collectReferences(projectRoot);
  const safeToDelete = media.filter((item) => !after.occurrences.has(item.reference));
  console.log(`Subidos: ${uploaded}. Documentos reescritos: ${rewritten}.`);
  console.log(
    `URLs de Storage verificadas contra metadata y checksum: ${verification.storageUrls}.`
  );
  if (safeToDelete.length) {
    console.log('Binarios originales elegibles para eliminación manual (este script no borra):');
    for (const item of safeToDelete) console.log(`  ${path.relative(projectRoot, item.filePath)}`);
  }
  const retained = media.filter((item) => after.occurrences.has(item.reference));
  if (retained.length) {
    console.log('Binarios que deben conservarse porque aún tienen referencias legacy en src/:');
    for (const item of retained) console.log(`  ${item.reference}`);
  }
  return { references, uploaded, rewritten, safeToDelete };
}

function parseOptions(args) {
  const allowed = new Set(['--dry-run', '--upload', '--rewrite-content']);
  if (!args.length || args.some((arg) => !allowed.has(arg)) || new Set(args).size !== args.length) {
    throw new Error(
      'Uso: node scripts/migrate-media-to-storage.mjs --dry-run | --upload [--rewrite-content] | --rewrite-content'
    );
  }
  const dryRun = args.includes('--dry-run');
  const upload = args.includes('--upload');
  const rewriteContent = args.includes('--rewrite-content');
  if (dryRun && (upload || rewriteContent)) {
    throw new Error('--dry-run no se combina con opciones que escriben.');
  }
  return { dryRun, upload, rewriteContent };
}

const executedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === executedPath) {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    await migrateMedia(projectRoot, parseOptions(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
