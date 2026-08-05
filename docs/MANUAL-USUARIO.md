# Manual de usuario del CMS

## Red Internacional de Memorias Participativas

Este manual explica cómo gestionar los contenidos del sitio desde **Decap CMS**. No es necesario editar archivos Markdown ni código para realizar las tareas habituales de publicación.

---

## 1. Qué se puede gestionar

El sitio organiza el contenido con una estructura similar a WordPress:

| Sección del CMS                          | Para qué sirve                                               |
| ---------------------------------------- | ------------------------------------------------------------ |
| **Entradas**                             | Noticias, artículos y novedades del sitio.                   |
| **Memorias del Museo de Memorias Vivas** | Piezas, experiencias y registros que forman parte del museo. |
| **Páginas informativas**                 | Páginas como El Simposio, Organización, Programa y Contacto. |
| **Ediciones de simposio**                | Datos generales de cada edición del simposio.                |
| **Categorías**                           | Clasificación temática jerárquica.                           |
| **Etiquetas**                            | Palabras clave para relacionar contenidos.                   |
| **Borradores**                           | Listados de contenidos guardados pero todavía no publicados. |

La página pública **Museo de Memorias Vivas** es el archivo que muestra las memorias. Cada memoria se gestiona como un contenido independiente dentro de su colección.

---

## 2. Acceder al panel de administración

### En producción

1. Abre la dirección del sitio y añade `/admin/`:

   ```text
   https://TU-DOMINIO.netlify.app/admin/
   ```

2. Inicia sesión con tu cuenta de Netlify Identity.
3. Si todavía no tienes cuenta, utiliza la invitación o el enlace de registro enviado por la administración.
4. Al terminar, verifica que aparece tu nombre o inicial en la esquina superior derecha.

### En desarrollo local

Esta opción está destinada al equipo técnico o a quien trabaje con una copia local del proyecto:

```bash
npm run dev:netlify-cms
```

Después abre:

```text
http://localhost:8888/admin/
```

El modo local utiliza `decap-server` para guardar cambios en los archivos del equipo. No es la dirección que deben utilizar los editores del sitio publicado.

---

## 3. Roles de usuario

El CMS utiliza dos roles principales:

### Administrador (`admin`)

Puede:

- gestionar todas las colecciones;
- publicar contenidos;
- editar páginas y ediciones de simposio;
- gestionar usuarios y roles;
- crear y administrar colecciones;
- editar configuraciones administrativas.

### Editor (`editor`)

Puede trabajar con el contenido editorial permitido, especialmente:

- crear y editar entradas;
- crear y editar memorias;
- guardar borradores;
- añadir categorías y etiquetas cuando tenga permisos.

La gestión real de usuarios se realiza desde el sitio desplegado en Netlify. El modo local sirve para probar el contenido y el CMS, pero no sustituye Netlify Identity.

Después de cambiar el rol de una persona, esa persona debe cerrar sesión y volver a entrar para que el nuevo rol aparezca en su token de acceso.

---

## 4. Cómo crear una entrada

Las entradas son noticias, artículos y novedades generales.

1. En el panel, abre **Entradas**.
2. Pulsa **New** o **Nueva entrada**.
3. Completa los campos principales:

   - **Título**: título visible de la entrada.
   - **Fecha de programación**: fecha futura opcional. Si es futura, la entrada no se muestra todavía.
   - **Simposio**: edición a la que pertenece la entrada.
   - **Fecha de publicación**: fecha que se mostrará y que se utiliza para ordenar las entradas.
   - **Autor/a**: persona o equipo responsable.
   - **Categorías**: temas principales.
   - **Etiquetas**: palabras clave.
   - **Imagen destacada**: imagen para tarjetas y cabeceras.
   - **Extracto**: resumen corto.
   - **Contenido**: texto completo en Markdown.

4. Revisa la vista previa.
5. Elige una de estas opciones:

   - **Publish now**: publica inmediatamente.
   - **Guardar como borrador**: guarda el contenido sin mostrarlo en el sitio público.

Una entrada publicada normalmente aparece en:

```text
/entradas/
```

---

## 5. Cómo crear una memoria del museo

Las memorias son los contenidos que forman el **Museo de Memorias Vivas**. No deben crearse como entradas normales, porque tienen campos propios.

1. Abre **Memorias del Museo de Memorias Vivas**.
2. Pulsa **New** o **Nueva memoria**.
3. Completa los campos:

   - **Número**: identificador numérico único de la memoria.
   - **Título**: nombre de la memoria o pieza.
   - **Lugar**: territorio, ciudad o espacio relacionado.
   - **Autor/a**: persona autora, si corresponde.
   - **Colectivo**: organización, colectivo o institución responsable.
   - **Simposio**: edición relacionada.
   - **Categorías**: temas principales.
   - **Etiquetas**: palabras clave.
   - **Imagen**: imagen principal de la memoria.
   - **Descripción corta**: texto que aparece en las tarjetas del museo.
   - **Texto completo**: contenido detallado de la memoria.

4. Comprueba que el **Número** no esté utilizado por otra memoria.
5. Revisa la vista previa.
6. Pulsa **Publish now** para publicar o **Guardar como borrador** para dejarla pendiente.

Las memorias publicadas aparecen en:

```text
/museo-memorias/
```

Cada memoria tiene una dirección basada en su número:

```text
/museo-memorias/1
/museo-memorias/2
```

### Reglas importantes para las memorias

- No reutilices el número de otra memoria.
- No cambies el número de una memoria ya publicada sin coordinarlo con la administración.
- No borres una memoria para corregir un título; edita el contenido existente.
- Utiliza categorías y etiquetas para facilitar la navegación y las relaciones.

---

## 6. Cómo editar una página informativa

Las páginas informativas sirven para contenidos estructurales del sitio.

1. Abre **Páginas informativas**.
2. Selecciona una página existente o crea una nueva.
3. Completa o revisa:

   - **Simposio**: edición a la que pertenece.
   - **Slug (URL)**: identificador de la dirección, por ejemplo `programa` o `contacto`.
   - **Página padre**: opcional, para crear una jerarquía.
   - **Portada del sitio**: solo debe existir una portada.
   - **Plantilla**: diseño que utilizará la página.
   - **Título**.
   - **Descripción**.
   - **Imagen de cabecera**.
   - **Email, Instagram y organizadores**, cuando corresponda.
   - **Contenido**.

4. Comprueba que la plantilla seleccionada corresponde al contenido.
5. Publica o guarda como borrador.

No cambies el `slug` de una página publicada sin revisar antes los enlaces que apuntan a ella.

---

## 7. Cómo gestionar una edición de simposio

Las ediciones contienen los datos generales que se utilizan en la portada y en las páginas del simposio.

1. Abre **Ediciones de simposio**.
2. Crea o edita una edición.
3. Completa:

   - título;
   - slug, por ejemplo `2026`;
   - número de edición;
   - año;
   - fecha;
   - lugar;
   - estado: activa, archivada o próxima;
   - tema;
   - imagen de cabecera;
   - cartel;
   - enlace al programa;
   - opción **Edición por defecto**.

Solo una edición debería estar marcada como predeterminada. La edición predeterminada se utiliza para mostrar la información principal en la portada.

---

## 8. Categorías y etiquetas

### Categorías

Las categorías describen el tema principal del contenido. Pueden tener una categoría padre.

Ejemplo:

```text
Cultura
└── Patrimonio
```

Para crear una categoría:

1. Abre **Categorías**.
2. Pulsa **Nueva categoría**.
3. Escribe el título.
4. Define un slug opcional.
5. Selecciona una categoría padre si corresponde.
6. Añade una descripción.
7. Guarda.

### Etiquetas

Las etiquetas son palabras clave más específicas y no tienen jerarquía.

Ejemplos:

```text
memoria
territorio
museo-memorias
participación
```

Recomendaciones:

- reutiliza etiquetas existentes cuando representen el mismo concepto;
- evita crear variantes innecesarias, como `Memoria`, `memorias` y `memoria-colectiva` sin criterio;
- utiliza slugs simples, sin espacios ni caracteres especiales.

---

## 9. Cómo guardar un borrador

Para guardar un contenido sin publicarlo:

1. Edita o crea la entrada, memoria o página.
2. Abre el menú desplegable del botón **Publish**.
3. Selecciona **Guardar como borrador**.
4. Espera a que Decap termine de guardar.
5. Comprueba que el indicador cambie de **UNSAVED CHANGES** a **SAVED**.
6. Verifica que aparezca en la sección correspondiente de **Borradores**.

Los borradores no se muestran en el sitio público.

### Para publicar un borrador

1. Abre **Borradores · Entradas**, **Borradores · Memorias** o **Borradores · Páginas**.
2. Selecciona el contenido.
3. Revisa y corrige la información.
4. Pulsa **Publish**.
5. Confirma que el contenido deja de aparecer en la sección de borradores.

---

## 10. Imágenes y archivos multimedia

Las imágenes que se suben desde el CMS se guardan en:

```text
public/images/
```

En el formulario, el CMS muestra la imagen con una ruta pública como:

```text
/images/nombre-de-la-imagen.jpg
```

Recomendaciones:

- utiliza nombres de archivo descriptivos;
- evita espacios, tildes y caracteres especiales;
- comprime las imágenes antes de subirlas;
- utiliza imágenes con suficiente resolución, pero no excesivamente pesadas;
- escribe siempre un título o texto alternativo cuando el campo esté disponible;
- no borres una imagen que todavía se utilice en una entrada o memoria.

---

## 11. Publicar correctamente una entrada o memoria

Antes de pulsar **Publish**, revisa:

- título y ortografía;
- imagen principal;
- descripción corta;
- categoría y etiquetas;
- simposio relacionado;
- autoría y colectivo;
- número único, si es una memoria;
- fecha de publicación;
- contenido completo;
- enlaces y Markdown;
- vista previa.

Una vez publicado, espera unos instantes a que Netlify genere la nueva versión del sitio.

---

## 12. Errores frecuentes

### Aparece `UNSAVED CHANGES`

El contenido todavía no se ha guardado. Espera unos segundos y revisa el mensaje de error. No cierres la ventana hasta confirmar **SAVED**.

### Aparece `Requires authentication` o `401 Unauthorized`

La sesión no está autorizada para escribir en el repositorio.

1. Cierra sesión.
2. Vuelve a iniciar sesión.
3. Comprueba que estás usando el sitio correcto.
4. Si continúa, contacta con un administrador.

En desarrollo local, asegúrate de que se está ejecutando:

```bash
npm run dev:netlify-cms
```

### No aparece una entrada o memoria publicada

Revisa:

- que `draft` no esté activo;
- que la fecha de programación no sea futura;
- que hayas pulsado **Publish** y no solo hayas cerrado el editor;
- que hayas seleccionado la colección correcta;
- que la edición del simposio sea la esperada.

### La imagen no aparece

Comprueba que:

- la imagen se subió correctamente;
- la ruta empieza por `/images/`;
- el nombre y la extensión coinciden;
- no se ha eliminado el archivo de `public/images/`.

### No aparece la colección Memorias

Recarga el panel con:

```text
Ctrl + Shift + R
```

Si estás en local, abre el CMS mediante:

```text
http://localhost:8888/admin/
```

Si el problema continúa, informa al equipo técnico sin modificar manualmente `config.yml`.

---

## 13. Buenas prácticas editoriales

- Utiliza títulos claros y consistentes.
- Escribe descripciones breves para las tarjetas.
- Mantén una misma forma de escribir nombres de lugares e instituciones.
- No dupliques categorías o etiquetas.
- Guarda como borrador cuando el contenido todavía no esté revisado.
- Publica solo después de comprobar la vista previa.
- No cambies slugs, números ni nombres de carpetas sin coordinación técnica.
- No edites directamente los archivos Markdown si no conoces el esquema de la colección.
- Si una publicación necesita una corrección importante, edita el contenido existente en lugar de crear otro duplicado.

---

## 14. Ayuda técnica

Para problemas de usuarios, permisos, despliegues o configuración del CMS, proporciona al equipo técnico:

- la URL desde la que accediste;
- la colección en la que trabajabas;
- el título del contenido;
- el mensaje exacto que aparece en pantalla;
- una captura de la consola solo si el equipo la solicita.

Nunca compartas contraseñas, tokens ni claves de GitHub.
