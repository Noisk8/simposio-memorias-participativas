import {
  S3Client,
  HeadBucketCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';

// Run after validate-backup-config and after loading the optional trusted CA.
// Report error codes only: SDK messages can include URLs and request details.
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  maxAttempts: 2,
});
let operation = 'comprobar el bucket de medios';
const code = (value) => (/^[a-zA-Z0-9_]{1,80}$/.test(value || '') ? value : 'desconocido');
try {
  const page = await client.send(
    new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, MaxKeys: 1 }),
    { abortSignal: AbortSignal.timeout(20_000) }
  );
  if (page.Contents?.[0]?.Key) {
    operation = 'leer un objeto de medios';
    const object = await client.send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: page.Contents[0].Key }),
      { abortSignal: AbortSignal.timeout(20_000) }
    );
    if (!object.Body) throw new Error('EmptyBody');
    object.Body.destroy();
  }
  operation = 'comprobar el bucket privado de respaldos';
  await client.send(new HeadBucketCommand({ Bucket: process.env.S3_BACKUP_BUCKET }), {
    abortSignal: AbortSignal.timeout(20_000),
  });
  console.log(
    'Garage: listado y acceso a medios, y existencia del destino de respaldo comprobados.'
  );
} catch (error) {
  console.error(
    `Garage: fallo al ${operation}; código ${code(error.code || error.name)}, causa ${code(error.cause?.code)}, HTTP ${Number(error.$metadata?.httpStatusCode) || 'no disponible'}.`
  );
  process.exitCode = 1;
}
