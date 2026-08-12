# GitHub App del CMS

El backend usa una GitHub App instalada únicamente en el repositorio editorial. Los tokens de instalación duran aproximadamente una hora y se renuevan en memoria; ni el token resultante ni la clave privada llegan al navegador. `GITHUB_TOKEN` queda como fallback temporal obsoleto.

## Permisos mínimos

Configura estos **Repository permissions**:

| Permiso         | Nivel          | Uso                                                                                  |
| --------------- | -------------- | ------------------------------------------------------------------------------------ |
| Contents        | Read and write | leer Markdown, crear ramas y commits                                                 |
| Pull requests   | Read and write | abrir y consultar PR; la función de merge queda encapsulada pero no se expone al CMS |
| Checks          | Read-only      | impedir que una eventual fusión programática ignore checks                           |
| Commit statuses | Read-only      | estado de CI y despliegue                                                            |
| Metadata        | Read-only      | GitHub lo concede automáticamente                                                    |

No hacen falta permisos de Issues, Members, Administration, Secrets ni Workflows. El permiso Workflows solo sería necesario si el CMS modificara `.github/workflows`, operación que esta arquitectura no permite.

## Creación e instalación

1. En GitHub abre **Settings → Developer settings → GitHub Apps → New GitHub App**. Usa un nombre identificable, la URL del sitio como Homepage y desactiva webhooks si no se van a consumir.
2. Selecciona únicamente los permisos de la tabla anterior. No solicites permisos de cuenta u organización.
3. Crea la App y copia su **App ID**.
4. Pulsa **Install App**, elige **Only select repositories** y selecciona exclusivamente este repositorio. El número presente en la URL de la instalación es el **Installation ID**.
5. En la App, genera una private key y descarga el `.pem`. No lo copies al repositorio ni a un archivo servido por Astro.
6. En **Netlify → Site configuration → Environment variables**, configura para todos los contextos que ejecuten Functions:

   ```text
   GITHUB_APP_ID
   GITHUB_APP_INSTALLATION_ID
   GITHUB_APP_PRIVATE_KEY
   GITHUB_APP_PRIVATE_KEY_BASE64 (alternativa recomendada en Netlify)
   GITHUB_REPO
   GITHUB_BRANCH
   ```

   `GITHUB_APP_PRIVATE_KEY` puede ser el PEM multilínea completo. También se aceptan saltos de línea representados por `\n`. En Netlify se recomienda `GITHUB_APP_PRIVATE_KEY_BASE64`: codifica el archivo PEM completo en Base64 y pega el resultado sin comillas; esta variable tiene prioridad si ambas existen.

7. Despliega y abre una colección desde el panel con una sesión autorizada. El log estructurado debe indicar `github.auth.mode` con `mechanism: github_app`; nunca imprime credenciales. Aprueba un documento de prueba y solicita publicar: debe aparecer una rama `cms/<uuid>/<timestamp>` y un PR.
8. Protege `main`: exige Pull Request, los checks de CI necesarios y al menos una revisión según la política editorial; bloquea force pushes. La fusión es manual desde GitHub.
9. Tras validar lectura, escritura, creación de rama y PR, elimina `GITHUB_TOKEN` de Netlify. Si el log muestra `legacy_token`, la App no está configurada en ese contexto.

Una configuración parcial de la App produce un error explícito y no cae silenciosamente al token personal. Los tokens de instalación se limitan de nuevo al repositorio y permisos declarados al solicitarlos.

## Flujo y recuperación

El CMS no fusiona automáticamente. Si CI falla, corrige la causa y deja que los checks vuelvan a ejecutarse; no evites la protección de rama. Si un PR se cierra sin merge, vuelve al documento en el panel para reconciliar el estado y solicita una nueva publicación. Si GitHub está caído, el registro queda en `failed` y un reintento reutiliza la rama reservada y el PR abierto cuando exista.

La API es idempotente en los puntos recuperables: reconoce una rama ya creada, busca un PR abierto antes de crear otro y devuelve el PR ya registrado para solicitudes repetidas.

## Referencias oficiales

- [Registrar una GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
- [Elegir permisos](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
- [Generar un token de instalación](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [Proteger ramas](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
