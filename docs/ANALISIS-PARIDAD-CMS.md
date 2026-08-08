# Análisis de paridad del CMS

Este documento toma como fuente de verdad el antiguo `public/admin/config.yml`, las extensiones de
`public/admin/index.html`, los modelos de contenido y las capturas del panel. Supabase sustituye
Netlify Identity y Git Gateway, pero no debe reducir las capacidades editoriales.

## Arquitectura visual observada

- Barra superior fija con marca, accesos a Inicio, Entradas, Memorias y Páginas, selector de tema y
  menú de usuario.
- Navegación lateral persistente, búsqueda global y secciones separadas para contenido,
  borradores, taxonomías y administración.
- Área central con cabecera de colección, descripción y acción contextual para crear.
- Controles de orden, agrupación y alternancia lista/cuadrícula.
- Tarjetas con título e imagen destacada.
- Panel flotante y colapsable de borradores recientes, contador, acceso a todos y limpieza de
  accesos rápidos.
- Tema claro/oscuro persistido en `localStorage` y diseño adaptable a pantallas pequeñas.

## Colecciones y comportamiento

| Colección  | Crear | Borrador | Orden                        | Agrupación/filtro   | Relaciones                      |
| ---------- | ----- | -------- | ---------------------------- | ------------------- | ------------------------------- |
| Entradas   | Sí    | Sí       | fecha, título, autor         | autor, mes          | simposio, categorías, etiquetas |
| Memorias   | Sí    | Sí       | número, título, lugar, autor | lugar, colectivo    | simposio, categorías, etiquetas |
| Páginas    | Sí    | Sí       | orden, título, simposio      | simposio, plantilla | simposio, página padre          |
| Simposios  | Sí    | No       | año, edición, título         | estado              | —                               |
| Categorías | Sí    | No       | título                       | categorías raíz     | categoría padre                 |
| Etiquetas  | Sí    | No       | título                       | —                   | —                               |
| Menús      | Sí    | No       | título                       | —                   | elementos jerárquicos           |

Las colecciones de borradores no son archivos diferentes: son vistas filtradas por `draft: true`
sobre entradas, memorias y páginas. Las vistas normales filtran `draft: false`.

## Flujo editorial

- «Guardar borrador» fuerza `draft: true`; «Publicar» fuerza `draft: false`.
- Una entrada sin fecha recibe automáticamente la fecha local actual.
- Categorías y etiquetas vacías o duplicadas se eliminan antes de guardar.
- `publish_date` permite programación y debe conservarse en el documento.
- El guardado usa la versión SHA del archivo para detectar ediciones concurrentes.
- El historial muestra commits del archivo y enlaza a la revisión en GitHub.
- Las acciones pasan por permisos RBAC de Supabase; el cliente no puede confiar en roles incluidos
  en metadatos manipulables.

## Edición y medios

- Markdown con previsualización simultánea.
- Vista previa específica para entradas: hero, fecha/autor, imagen, taxonomías, extracto y cuerpo.
- Vista previa específica para memorias: número, lugar, autoría, colectivo, imagen, taxonomías,
  resumen y cuerpo.
- Biblioteca de imágenes, subida desde campos de imagen, copia de ruta y eliminación autorizada.
- Selectores relacionales buscables para simposio, categorías, etiquetas y jerarquías.

## Administración complementaria

- Gestión de usuarios y asignación de roles.
- Gestión y creación de colecciones.
- Historial de revisiones.
- Tour/bienvenida, mensajes de resultado y control de sesión.
- Acciones destructivas con confirmación y registro de auditoría.

## Matriz de sustitución tecnológica

| CMS anterior                 | Implementación nueva                                          |
| ---------------------------- | ------------------------------------------------------------- |
| Netlify Identity             | Supabase Auth (`signInWithPassword`, sesión renovable)        |
| Roles en metadatos           | RBAC normalizado en PostgreSQL                                |
| Git Gateway en navegador     | Functions autenticadas con credencial GitHub solo en servidor |
| Decap collections            | API `manage-content` con modelos Zod canónicos                |
| Decap media                  | API `manage-media`                                            |
| Hooks `preSave`/`prePublish` | Validación, permisos y normalización en servidor              |
| Preview templates            | Previsualizador propio reactivo                               |

## Criterio de aceptación

La migración solo tiene paridad cuando cada elemento anterior puede ejecutarse desde el nuevo
panel, conserva sus reglas de datos y permisos, y se presenta dentro del shell visual descrito.
Que exista un endpoint CRUD no es suficiente por sí solo.
