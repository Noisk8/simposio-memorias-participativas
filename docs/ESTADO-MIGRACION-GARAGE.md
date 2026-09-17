# Estado de la migración — 17 de septiembre de 2026

Código preparado en `feat/garage-editorial-content`, sobre `origin/main` (`ae46c3f`). No desplegado ni activado.

- Catálogo consultado: 55 borradores, 58 versiones y 36 medios activos.
- Medios: 33 objetos copiados/verificados en el nuevo `cms-media`; SHA-256 y lectura HTTPS pública comprobados.
- Se conservaron originales y URLs activas del catálogo.
- Tres objetos ausentes en el endpoint nuevo; el dominio antiguo respondió con certificado TLS autofirmado y no se deshabilitó su validación.
- Textos y snapshot del sitio: pendientes de crear el bucket privado `cms-content` y otorgar acceso a la clave S3.
- La clave S3 no tiene permiso para crear buckets (403); consultar la preparación en [CONTENIDO-EN-GARAGE.md](CONTENIDO-EN-GARAGE.md).
- Supabase: no se reemplazaron textos ni se aplicó el SQL final.
- Verificación: 163 pruebas aprobadas, build aprobado y análisis de tipos sin errores. El SQL final no se ha ejecutado contra PostgreSQL.

## Medios pendientes de recuperar

- `17b3b50e-6780-4b76-b38d-a651efb5db79` — `images/2026/09/f4d85bed-05e1-4601-ac42-a8e6466288ab-captura-desde-2026-09-15-02-18-36.webp`
- `73432100-b081-40d4-a7c2-84e2a39fc9c5` — `images/2026/09/59d28e61-6599-4701-ad2a-8993a35f5786-captura-desde-2026-08-18-14-19-06.webp`
- `770a786f-7e7f-4e0f-bf6f-645b61c159bb` — `images/2026/09/2d9a24ac-cb9a-4513-a9c5-bfd1f6cac827-captura-desde-2026-09-14-22-48-52.webp`

El informe operativo completo se encuentra localmente en `/tmp/garage-media-copy-report.json`. No se versiona porque conserva metadata de las filas para la recuperación. Los objetos copiados ya existen en Garage, aunque el panel sigue utilizando las referencias anteriores hasta la fase de activación.
