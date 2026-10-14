# tickets-prestamos

Panel Kanban para consultar equipos y reservas desde AppSheet.

## Configuración local

1. Copiá `.env.example` como `.env`.
2. Completá `APPSHEET_APP_ID` y `APPSHEET_ACCESS_KEY` con una clave nueva.
3. Ejecutá `npm run dev`.

El frontend consulta `/api/boards`. En local, `server.js` usa la clave para leer las tablas de AppSheet y nunca la expone al navegador.

La integración usa únicamente la acción `Find` sobre estas tablas:

- `Reservas`
- `Sets`
- `Usuarios`

Las reservas del día se agrupan por set en tres tableros horizontales. El panel se actualiza automáticamente cada 30 segundos.

## Despliegue en Cloudflare Pages

1. Subí este repositorio a GitHub o GitLab.
2. En Cloudflare, abrí `Workers & Pages` y elegí `Create application > Pages > Connect to Git`.
3. Seleccioná el repositorio.
4. Configurá el build:
   - Framework preset: `Vite`
   - Build command: `npm run build`
   - Build output directory: `dist`
5. En `Settings > Environment variables`, agregá estas variables para `Production` y `Preview`:
   - `APPSHEET_APP_ID`
   - `APPSHEET_ACCESS_KEY`
6. Guardá y ejecutá un nuevo deploy.

Cloudflare detecta automáticamente `functions/api/boards.js` y publica el endpoint `/api/boards`. No uses el prefijo `VITE_` en estas variables, porque la clave debe permanecer del lado del servidor.

El archivo `server.js` se usa solo para desarrollo local. En Cloudflare Pages la consulta se ejecuta mediante Pages Functions.
