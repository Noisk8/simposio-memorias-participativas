# Movimiento del home

Referencia revisada: [Lusion](https://lusion.co/), 12 de octubre de 2026.

La inspección del JavaScript público de Lusion confirma estos mecanismos:

- `Line.update` convierte la posición de la sección en un progreso entre 0 y 1,
  aplica una curva de aceleración y revela una línea 3D hasta ese punto. Su extremo
  se mueve por el mismo recorrido. Al subir, el recorrido se retrae.
- `HomeReelSection.update` interpola entre la posición y el tamaño de una miniatura
  y los del panel de video. El shader de vértices distribuye esa interpolación por
  la superficie para deformarla y girarla durante la expansión. El color pasa de
  una imagen teñida al color original del video.
- Los textos se dividen en palabras o caracteres y aparecen mediante traslación,
  giro y retrasos. Las cruces decorativas giran al completarse la expansión.
- Un gestor de scroll suaviza el desplazamiento; el video se pausa fuera de su
  sección. La presentación móvil utiliza otra disposición y otro video.

## Adaptación al simposio

`HomeIntro.astro` conserva el título, la sede, la imagen y el video del simposio.
`HomeVector.astro` aporta un único SVG en los verdes del proyecto que empieza en
la segunda sección, «Memorias que nos conectan», y continúa por el video,
Cartel Oficial, Explora e Instagram. Se dibuja al bajar y se
recoge al subir. Las curvas se calculan con la altura y posición reales de cada
sección; un mapa de longitud y altura mantiene el extremo cerca del 82 % de la
pantalla. El dibujo pasa detrás de textos, imágenes, tarjetas y controles, sin
interceptar el ratón ni el teclado. No es una reproducción de la geometría 3D de Lusion.
El hero queda fuera del recorrido. El SVG se entrega sin geometría y con el extremo
oculto hasta calcular las medidas, para evitar que aparezca un tramo en el hero
durante la carga; sin JavaScript no se muestra este elemento decorativo.

La entrada del video combina escala, inclinación, giro y reducción del radio de
las esquinas. En escritorio, un contenedor sticky mantiene la escena visible
durante parte del recorrido. En móvil, el video permanece en el flujo y la escala
es menos pronunciada. Esta aproximación no incluye la deformación de superficie,
los shaders, las interacciones 3D de la portada ni la transición cromática original.

`home-motion.ts` calcula el progreso con el scroll nativo y actualiza la escena
con `requestAnimationFrame`. Solo mantiene cuadros adicionales mientras termina
la interpolación de la escala. Las medidas se recalculan al cambiar el tamaño,
cargar las fuentes o cambiar la altura del encabezado o del home, incluyendo
la carga del cartel y los cambios de disposición. No añade dependencias.

Las entradas de los objetos toman como referencia `HomeFeaturedSection` y
`ProjectItem`: Lusion anima los caracteres del título con desplazamiento vertical,
giro y retrasos; las imágenes entran desde lados alternados con giro y revelado.
`GoalSection` transforma un marco de fondo y varía su radio durante la transición.

`home-reveals.ts` adapta esas entradas con palabras en máscaras individuales,
conservando espacios, saltos de línea y nombres accesibles. El cartel se revela
con escala, inclinación y una máscara que termina mostrando la imagen completa.
Explora combina entradas desde lados alternados, perspectiva y retrasos sucesivos;
al pasar el mouse o enfocar, la tarjeta se eleva y su flecha avanza. Instagram
presenta primero el título, después el panel, el icono, el nombre y el botón.
También se separan las entradas del título, la descripción y los pies del video.

Los bordes superiores de Cartel Oficial, Explora e Instagram se despliegan y
reducen su curvatura según el scroll, sin transformar la sección ni modificar
el recorrido del vector. Las medidas se reutilizan entre cuadros. En móvil las
entradas de los objetos tienen menos giro y desplazamiento.

Contenedores sin máscara activan cada grupo de objetos mediante
`IntersectionObserver`; el cartel conserva espacio y carga diferida. Las entradas
ocurren una vez y el contenido permanece visible después. El foco revela de
inmediato el grupo completo, y el movimiento reducido elimina las transformaciones,
las máscaras y los bordes animados. No se reproducen los shaders de profundidad,
las ondas, el desenfoque o la geometría 3D de Lusion.

Los videos conservan su poster si falla la reproducción. El fondo tiene un botón
de pausa y el videoresumen ofrece controles nativos; las vistas previas se pausan
fuera de pantalla y al ocultar la pestaña. El videoresumen no se reinicia de forma
automática después de interactuar con sus controles.

Con `prefers-reduced-motion`, el vector queda completo, se eliminan las
transformaciones y el tramo sticky, y no se inicia reproducción automática. Sin
JavaScript, el contenido y los controles del video permanecen disponibles.

Las pruebas de navegador de `e2e/home-motion.spec.ts` verifican el avance y el
retroceso por todas las secciones, la expansión, el móvil, los cambios de altura
del cartel, el movimiento reducido y la ausencia de JavaScript.
`e2e/home-reveals.spec.ts` comprueba las entradas independientes del título y del
cartel, la secuencia de las tarjetas, la transición entre secciones y la revelación
inmediata por teclado.

## Estela de imágenes del hero

Referencia revisada: [Make Me Pulse](https://www.makemepulse.com/), 12 de octubre
de 2026. La observación en navegador muestra varias imágenes superpuestas que
siguen el recorrido del mouse, con pequeñas rotaciones y entrada suave. Al parar
el cursor desaparecen; la tipografía permanece delante. El sitio utiliza una
capa `image-trail`, una zona de interacción `image-trail-target` y canvases
`sprites`. Nuestra adaptación conserva ese comportamiento visual con elementos
HTML y la API nativa de animación del navegador.

`hero-image-trail.ts` suaviza la posición del cursor y emite una tarjeta cada
64 píxeles, con un intervalo mínimo de 65 ms. Cada tarjeta entra con escala y giro,
permanece brevemente y se desvanece con una deriva durante 1,1 segundos. Reutiliza
como máximo ocho tarjetas con imágenes locales de proyectos; solo las descarga
después del primer movimiento real del mouse. Una imagen fallida no se muestra.

La capa decorativa queda por debajo del título y de los controles, no recibe
eventos y está oculta para tecnologías de asistencia. Un velo y la sombra del texto
mantienen su legibilidad sobre las fotografías. Al detener el mouse cesan los
cuadros de JavaScript; al salir del hero las tarjetas completan su desvanecimiento.
El scroll, el cambio de tamaño, ocultar la pestaña o activar movimiento reducido
cancelan las animaciones. En dispositivos táctiles y con movimiento reducido no
se activa la estela ni se descargan sus imágenes.

`e2e/hero-image-trail.spec.ts` verifica la aparición simultánea de varias imágenes,
su desaparición, la reutilización de tarjetas, el título y los enlaces disponibles,
y la desactivación de la estela en pantallas táctiles y con movimiento reducido.
