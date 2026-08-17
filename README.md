# InstaFollower

PWA local para analizar una exportación de Instagram (`.zip`) y cruzar **following** vs **followers**, mantener historial entre exportaciones y asociar likes importados desde CSV/texto.

## Funciones

- Importa directamente el ZIP de Instagram.
- Detecta `followers_1.json`, `followers_2.json`, etc. y `following.json`.
- Muestra cuentas que sigues clasificadas como:
  - **Te sigue**
  - **No te sigue**
  - **Personaje/Tienda**
- Abre perfiles en la app de Instagram en Android, con fallback web.
- Guarda snapshots en IndexedDB y compara la exportación nueva con la anterior.
- Importa likes desde CSV o texto; cada aparición del username cuenta como un like.
- Incluye como seed inicial 227 apariciones de likes (127 usernames) y 507 cuentas marcadas inicialmente como Personaje/Tienda.
- Funciona offline después de la primera carga gracias al Service Worker.
- Diseño móvil vertical optimizado para Android / Galaxy S22 Ultra.

## Publicar en GitHub Pages

1. Crea un repositorio, por ejemplo `InstaFollower`.
2. Sube **todo el contenido de esta carpeta a la raíz del repositorio**, incluyendo `.github`, `icons` y `.nojekyll`.
3. Asegúrate de que la rama principal se llame `main`.
4. En GitHub abre **Settings → Pages**.
5. En **Build and deployment → Source**, elige **GitHub Actions**.
6. Ve a **Actions** y espera a que termine `Deploy InstaFollower to GitHub Pages`.
7. GitHub mostrará la URL del sitio, normalmente:
   `https://TU-USUARIO.github.io/InstaFollower/`

No necesitas configurar una ruta base: todos los recursos usan URLs relativas y funcionan correctamente dentro de `/InstaFollower/`.

## Instalar en Chrome Android

1. Abre la URL de GitHub Pages en **Chrome** en el teléfono.
2. Espera a que cargue la app por primera vez.
3. Si aparece el icono de instalación en InstaFollower, púlsalo.
4. Si Chrome no muestra ese icono, abre **⋮ → Instalar aplicación** o **Añadir a pantalla principal** (el texto puede variar).
5. Después de instalarla se abre en modo `standalone`, sin la barra normal del navegador.

## Privacidad

La app no necesita servidor, cuenta de Instagram ni API de Instagram. Los ZIP/CSV seleccionados se procesan en el navegador y los datos persistentes quedan en IndexedDB del dispositivo.

**Importante:** `seed-data.js` contiene los likes iniciales y la lista Personaje/Tienda que se solicitó precargar. Si publicas este repositorio/sitio públicamente, ese archivo también será públicamente accesible. Si prefieres mantener esos datos privados, elimina `seed-data.js` y la referencia correspondiente antes de publicar, y luego impórtalos desde la propia app.

## Actualizaciones

Al publicar cambios, aumenta el nombre de caché en `sw.js` (por ejemplo `instafollower-shell-v1.2.1`). El Service Worker borra automáticamente las cachés de versiones anteriores.
