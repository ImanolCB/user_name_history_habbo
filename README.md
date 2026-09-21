# HabboNames

Aplicación para consultar nombres de Habbo con tabla pública de solo lectura, bandeja de sugerencias y panel privado de administración. Usa Turso/libSQL en producción y SQLite local como fallback de desarrollo.

## Requisitos

- Node.js 18 o superior
- Una base de datos Turso para producción

## Uso

```bash
npm install
npm start
```

Abre http://localhost:3000.

El CSV puede tener una columna llamada `name`, `nombre`, `username` o `user`. Si no tiene cabecera reconocible, se usa la primera columna de cada fila.

- En la primera consulta, se usa `GET /api/public/users?name=...`.
- Si el nombre ya existe localmente y tiene `uniqueId`, se usa `GET /api/public/users/{uniqueId}`.
- Una respuesta 404 se guarda como `not_found` y se muestra como "No existe".
- La base se guarda en `data/habbo.sqlite`.
- La tabla principal se pagina a 25 registros y la búsqueda también encuentra nombres históricos.
- Se pueden añadir nombres individualmente, editar registros con error y actualizar una fila concreta.
- "Sincronizar nombres actuales" consulta todos los registros: usa `uniqueId` cuando existe y el endpoint por nombre solo para recuperar el ID de registros con error sin ID.
- La actividad de sincronización se consulta desde "Ver actividad" con permiso especial. En desarrollo la contraseña es `habbo-admin`; para cambiarla, inicia el servidor con `ADMIN_PASSWORD=...`.

## Turso y permisos

Copia `.env.example` a `.env` y define `TURSO_DATABASE_URL_ADMIN`, `TURSO_AUTH_TOKEN_ADMIN`, una contraseña fuerte en `ADMIN_PASSWORD` y un valor largo y aleatorio en `ADMIN_PATH_SECRET`. No publiques `.env` ni los tokens de Turso. En producción, las cuatro variables son obligatorias.

Para llevar los datos locales existentes a Turso:

```bash
npm run migrate:turso
```

La página `/` solo permite consultar la tabla y enviar sugerencias. El propietario entra en `/admin/<ADMIN_PATH_SECRET>` y después introduce `ADMIN_PASSWORD`; `/admin` sin el secreto responde `404`. Desde el panel puede importar CSV, sincronizar, borrar registros, aceptar o rechazar sugerencias y consultar la actividad.

La ruta secreta no sustituye a la contraseña: funciona como una primera barrera y la contraseña crea una sesión firmada durante ocho horas. En Vercel configura `ADMIN_PATH_SECRET` como variable de entorno y no la publiques en enlaces, capturas ni el repositorio.
