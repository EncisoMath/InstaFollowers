# InstaFollower

PWA para GitHub Pages que analiza localmente una exportación de Instagram (`.zip`), cruza **following** vs **followers**, mantiene historial entre exportaciones y asocia likes importados desde CSV/texto.

## Privacidad por diseño

Este repositorio **NO contiene usernames, likes, clasificaciones Personaje/Tienda ni exportaciones de Instagram del usuario**. El código publicado en GitHub es únicamente la aplicación.

Los ZIP, CSV, clasificaciones, likes e historial se procesan en el navegador y quedan en **IndexedDB del dispositivo**. No se envían a GitHub ni a un servidor de InstaFollower.

Si tienes el archivo `InstaFollower_DATOS_PRIVADOS.json`, guárdalo fuera del repositorio. En la app ve a **Ajustes → Importar datos privados** para cargarlo una sola vez. La importación combina likes y clasificaciones con los datos locales sin tocar el historial de snapshots.

> **No subas `InstaFollower_DATOS_PRIVADOS.json` a GitHub.**

## Funciones

- Importa directamente el ZIP de Instagram.
- Detecta `followers_1.json`, `followers_2.json`, etc. y `following.json`.
- Muestra cuentas que sigues como **Te sigue**, **No te sigue** y **Personaje/Tienda**.
- Abre perfiles en Instagram en Android, con fallback web.
- Guarda snapshots en IndexedDB y compara una exportación nueva con la anterior.
- Importa likes desde CSV o texto; cada aparición del username cuenta como un like.
- Importa un paquete privado JSON local sin publicarlo.
- Funciona offline después de la primera carga mediante Service Worker.
- Interfaz negra / azul navy optimizada para Galaxy S22 Ultra y móviles Android.

## Publicar en GitHub Pages

1. Crea un repositorio, por ejemplo `InstaFollower`.
2. Sube **todo el contenido de esta carpeta a la raíz**, incluyendo `.github`, `icons` y `.nojekyll`.
3. No subas archivos privados de Instagram ni `InstaFollower_DATOS_PRIVADOS.json`.
4. Asegúrate de que la rama principal sea `main`.
5. En GitHub abre **Settings → Pages**.
6. En **Build and deployment → Source**, selecciona **GitHub Actions**.
7. El workflow incluido en `.github/workflows/deploy-pages.yml` publicará la aplicación.
8. La URL será normalmente `https://TU-USUARIO.github.io/InstaFollower/`.

Todos los recursos usan rutas relativas, así que funcionan dentro de la ruta del repositorio.

## Instalar en Chrome Android

1. Abre la URL de GitHub Pages en Chrome.
2. Espera a que cargue una vez.
3. Pulsa el botón de instalación si aparece, o usa **⋮ → Instalar aplicación / Añadir a pantalla principal**.
4. Una vez instalada, InstaFollower abre en modo `standalone` y mantiene el shell disponible offline.

## Cargar tus datos privados

En **Ajustes → Importar datos privados**, selecciona `InstaFollower_DATOS_PRIVADOS.json`. El archivo se lee localmente en el navegador. Después de importarlo puedes guardarlo en un lugar privado o eliminar la copia del teléfono; la información queda persistida en IndexedDB.

## Actualizaciones

La versión de caché actual es `instafollower-shell-v1.2.4`. Al publicar nuevas versiones, cambia ese identificador para que el Service Worker descarte el shell anterior.


## Regla de “No te siguen”

El filtro y el contador **No te siguen** excluyen automáticamente cualquier cuenta marcada como **Personaje/Tienda**. Esas cuentas siguen disponibles en **Todos** y en su filtro independiente **Personaje/Tienda**.


### v1.2.4 — estabilidad de scroll
Al marcar o desmarcar una cuenta como Personaje/Tienda, la lista conserva la posición visual y la profundidad ya cargada. Esto evita saltos al reclasificar perfiles, incluso dentro del filtro **No te siguen**.
