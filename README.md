# Presupuestos App

Aplicación HTML/JavaScript multiempresa con Supabase. Incluye presupuestos, órdenes de trabajo, firma remota y administración de suscripciones mensuales.

## Administración y empresa

El perfil con es_superadmin = true puede alternar entre **Administrar plataforma** y **Trabajar en mi empresa**. Los administradores de cada empresa ven únicamente su operación y su suscripción; los miembros no tienen acceso al detalle de pagos ni a editar los datos de empresa.

El panel de plataforma permite:

- Buscar empresas por nombre, RUT o correo y filtrar acceso y suscripción.
- Revisar totales de empresas, acceso operativo, suscripciones vencidas y pagos recibidos en el mes.
- Aprobar, suspender, bloquear, archivar y reactivar, registrando un motivo.
- Cambiar cupos sin reducirlos por debajo de los usuarios existentes.
- Configurar un plan individual por empresa, precio mensual CLP, inicio y días de gracia.
- Registrar mensualidades completas verificadas por transferencia, con referencia única y fecha.
- Consultar los últimos 100 pagos y 50 movimientos de cada empresa.
- Eliminar definitivamente una empresa archivada **solo si no tiene presupuestos, órdenes públicas ni pagos**. Se borran sus perfiles de empresa; se conservan las cuentas de autenticación y el historial administrativo.

## Activación en una base existente

Los archivos locales están preparados; modificar este repositorio no actualiza automáticamente Supabase ni el sitio publicado.

1. Hacer un respaldo de la base y comprobar la migración en una copia del entorno.
2. En el SQL Editor del proyecto existente, ejecutar completo y **una sola vez**:
   **supabase/migrations/202610050001_plataforma.sql**.
   La migración es transaccional. Si falla, no queda aplicada parcialmente.
   **No volver a ejecutar supabase_schema.sql**: es el archivo de instalación inicial e incluye datos de ejemplo.
3. Desplegar la versión actualizada de **supabase/functions/invitar-usuario/index.ts** con el mecanismo habitual de Edge Functions. Ejemplo, con la CLI ya configurada:
   supabase functions deploy invitar-usuario --project-ref TU_PROJECT_REF
4. Publicar juntos index.html, app.js, data.js, styles.css, platform.js y platform.css en el alojamiento actual.
5. Entrar con el superadministrador existente y comprobar ambos espacios. Crear una empresa de prueba y verificar aprobación, plan, pago y suspensión antes de habilitar cobros reales.

No se crean administradores nuevos ni se modifica quién es superadministrador. No se han ejecutado cambios en el proyecto de producción desde estas pruebas.

Si la migración todavía no existe, la interfaz muestra un aviso de actualización pendiente y mantiene el funcionamiento anterior de las empresas aprobadas. La gestión nueva requiere aplicar primero la migración.

## Transición de empresas actuales

La migración copia aprobada a estado_acceso: true → autorizada, false → pendiente. El esquema anterior no distinguía entre pendiente y suspendida; revisar esos casos en el panel después de migrar.

Las empresas que existían al migrar reciben acceso_transitorio = true. Mientras no tengan suscripción, conservan su acceso aprobado sin cobros ni vencimientos inventados. Al configurarles una suscripción, se aplica ese ciclo.

Las empresas creadas después de migrar reciben acceso_transitorio = false: requieren autorización y una suscripción que permita operar. Los clientes no pueden cambiar este indicador, su aprobación, cupo, rol o condición de superadministrador mediante la API.

## Reglas mensuales

- Moneda: CLP, importes enteros mayores que cero.
- La fecha de inicio es el primer vencimiento. Antes de esa fecha no empieza la operación.
- Cada pago cubre el siguiente período mensual pendiente completo. Se pueden registrar meses anticipados, uno por uno y con una referencia distinta por registro.
- El próximo vencimiento se calcula desde la fecha inicial y el número de períodos pagados. Ejemplo: 31 enero → 28/29 febrero → 31 marzo. Pagar tarde no desplaza el aniversario.
- El período incluye su inicio y excluye su fin. Con vencimiento el día 5 y 5 días de gracia, el acceso por gracia termina al comenzar el día 10.
- Las fechas de acceso se evalúan en America/Santiago en el servidor.
- Una referencia repetida para la misma empresa se rechaza. Reintentar el mismo identificador de pago con los mismos datos devuelve el pago existente y no extiende otra vez el período.
- Un pago no levanta un bloqueo, suspensión o archivo administrativo.
- Cancelar conserva el tiempo ya pagado y elimina la gracia posterior. Reactivar mantiene el ciclo original.
- El inicio no se puede cambiar una vez que hay pagos. Cambios de precio se aplican al siguiente período que se registre, incluso si está atrasado. Los pagos previos conservan su monto.
- No hay cobro automático, carga de comprobantes, pagos parciales, facturación tributaria, avisos automáticos ni reembolsos en esta versión. Los pagos se verifican externamente y se registran en el panel. No se deben introducir pagos de prueba en producción.

## Acceso y documentos

Supabase aplica la restricción de suscripción a los presupuestos y a la publicación de órdenes, además de los controles de la interfaz. La sesión abierta actualiza su estado cada minuto; el servidor comprueba el acceso en cada operación protegida.

Los enlaces de firma ya emitidos siguen disponibles para que el cliente firme, incluso si la empresa está suspendida. Crear o modificar una publicación requiere autenticación, pertenencia a la empresa y acceso operativo.

La restricción no elimina documentos. Una empresa sin acceso conserva la pantalla de estado de su suscripción; el administrador de empresa puede consultar sus pagos. Un superadministrador conserva acceso al panel de plataforma aunque la operación de su propia empresa esté restringida.

El historial registra el usuario administrador, fecha y cambio. Las empresas con actividad se dan de baja mediante **Archivar**. La eliminación de empresas vacías requiere escribir el nombre exacto y conserva una entrada de auditoría con su identidad.

## Archivos

- platform.js: panel, ficha, vista de suscripción, estados y actualización de sesión.
- platform.css: estilos adaptados a escritorio y móvil.
- supabase/migrations/202610050001_plataforma.sql: tablas, funciones, auditoría y permisos.
- tests/: pruebas de fechas/HTML, PostgreSQL temporal y navegador con datos simulados.

## Pruebas

Con Node.js disponible:

    cd tests
    npm install
    npm test

Para pnpm en una carpeta sincronizada, usar copias sin enlaces:

    pnpm install --node-linker=hoisted --package-import-method=copy

El test de navegador usa Chrome si existe en la ruta estándar de Windows. Se puede indicar CHROME_PATH o instalar el Chromium de Playwright con npx playwright install chromium.

Las pruebas de base de datos ejecutan el esquema existente y la migración en PostgreSQL temporal (PGlite), sin usar claves ni registros reales. Cubren aislamiento entre empresas, privilegios heredados, autoescalamiento de permisos, pagos duplicados, vencimiento, archivo, eliminación, nuevas empresas sin plan, publicación de órdenes y continuidad de firma pública.

Las pruebas de navegador simulan Supabase: verifican ambos espacios, filtros, ficha, suscripción, registro de pago, bloqueo y anchura móvil. Las capturas quedan en tests/artifacts/, excluidas de Git.

La verificación local no sustituye la comprobación del esquema y políticas realmente instalados en producción.
