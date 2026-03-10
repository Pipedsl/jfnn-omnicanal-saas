# Backlog de Proyecto: JFNN Omnicanal SaaS (Sprint 6 y Pendientes)

Dado que no se detectó un repositorio remoto de GitHub configurado para crear los Issues automáticamente a través de la API, se detalla el listado de Épicas y Tareas (Issues) a continuación:

## Épica: Flujo End-to-End y Cierre de Ventas

### [P0] Persistencia Real en Supabase (Migrar de RAM a DB)
**Objetivo:** Asegurar que todo el estado conversacional y las sesiones de los usuarios persistan de forma segura y centralizada en Supabase, eliminando cualquier dependencia de memoria temporal (RAM).
**Criterios de Aceptación (DoD):**
- Revisar y auditar la capa de conexión entre el webhook de WhatsApp y `sessions.service.js`.
- Confirmar que al reiniciar el servidor de Node.js, las sesiones en curso (`PERFILANDO`, `ESPERANDO_VENDEDOR`, etc.) se reanuden correctamente desde la base de datos.
- Las entidades (vehículo, repuestos, estado) deben coincidir exactamente con lo guardado en PostgreSQL.

### [P1] Bucle de Cierre (Pago y Logística)
**Objetivo:** Cerrar la venta a través de WhatsApp interactuando con las confirmaciones del vendedor en el Dashboard Next.js.
**Criterios de Aceptación (DoD):**
- El agente IA (en estado `CONFIRMANDO_COMPRA`) debe ser capaz de solicitar método de pago y despacho.
- Debe soportar la recepción de fotografías (comprobantes de transferencia) e identificarlas utilizando Gemini Flash/Pro.
- Procesar envíos a domicilio (captura de dirección) vs retiros en local.
- Notificar al Dashboard que el pago fue realizado y cambiar el estado a `PAGO_VERIFICADO`.
- Una vez el vendedor confirme la entrega física/logística, cambiar la sesión a `ENTREGADO`.

---

## Épica: Automatización Post-Venta y Fidelización

### [P2] Sistema de Reseñas Automáticas
**Objetivo:** Recolectar feedback orgánico de los clientes para mejorar la reputación y medir la satisfacción.
**Criterios de Aceptación (DoD):**
- Configurar un job o proceso diferido que detecte sesiones que pasaron a `ENTREGADO` hace 24-48 horas.
- El bot enviará un mensaje automatizado y amigable consultando qué tal funcionó el repuesto y cómo fue la atención.
- Guardar la calificación o feedback bruto en una nueva tabla de Supabase (ej. `reviews`).
- Cambiar la sesión al estado final `CICLO_COMPLETO` o `ARCHIVADO`.

---

## Épica: Entrenamiento Contextual y Bases de Conocimiento

### [Task] Inyección de knowledge-base.md
**Objetivo:** Permitir que Gemini responda en base a las reglas duras del negocio sin sobrecargar el código de `gemini.service.js`.
**Criterios de Aceptación (DoD):**
- Crear el archivo `knowledge-base.md` en el backend.
- Modificar `gemini.service.js` para cargar dinámicamente el contenido de este archivo en el System Prompt.
- Realizar pruebas para asegurar que el agente reconozca horarios, políticas de devolución y métodos de pago oficiales sin alucinar.
