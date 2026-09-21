# HabboNames

Aplicación local sencilla para importar nombres desde CSV, buscarlos en la API pública de Habbo y guardar los resultados en SQLite.

## Requisitos

- Node.js 18 o superior

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
